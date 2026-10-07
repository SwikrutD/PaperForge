import { clipboard, dialog, nativeImage, type BrowserWindow } from 'electron';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { AppError } from '@shared/errors/appError';
import type { ExportResult } from '@shared/schemas/pages';
import type { PageImageModel, PageImagesModel } from '@shared/schemas/image';
import { placementOf, type ImagePlacement } from '@pdf/content/images';
import { resourcesOf } from '@pdf/content/pageContent';
import { exportImage, isAddedImage } from '@pdf/mutate/imageResources';
import { cropImagePixels } from '@pdf/mutate/imageCrop';
import { nativeImageCodec } from '../../services/optimize/nativeImageCodec';
import { findImage, imageIdOf, readPageWithImages } from '@pdf/mutate/images';
import type { DocumentEditor } from '../../services/documents/documentEditor';
import type { DocumentService } from '../../services/documents/documentService';
import type { StagedAssets } from '../../services/documents/stagedAssets';
import { writeFileAtomic } from '../../services/filesystem/atomicWrite';
import { clipboardPicture } from '../../services/documents/clipboardPicture';
import type { RegisterInvoke } from '../registry';

export interface ImageHandlerDeps {
  documents: DocumentService;
  editor: DocumentEditor;
  stagedAssets: StagedAssets;
  senderWindow: (event: Electron.IpcMainInvokeEvent) => BrowserWindow;
}

const CANCELED: ExportResult = { canceled: true, paths: [], directory: null };

/**
 * The images a page draws: what they are, where they come from, where they go.
 *
 * An image's id holds only for the revision it was read from, because every
 * change rewrites the page's content — the editor reads the page again after
 * each one rather than patching what it has.
 */
export function registerImageHandlers(
  registerInvoke: RegisterInvoke,
  deps: ImageHandlerDeps,
): void {
  registerInvoke('images:page', async ({ sessionId, page }) => {
    const document = await load(deps, sessionId);
    if (page < 1 || page > document.getPageCount()) {
      throw new AppError('internal/unexpected', {
        message: 'That page is not in this document.',
        details: `page ${String(page)} of ${String(document.getPageCount())}`,
      });
    }

    const content = await readPageWithImages(document, page - 1);
    const model: PageImagesModel = {
      page,
      revision: deps.editor.revisionOf(sessionId),
      images: content.images.map(describeImage),
    };
    return model;
  });

  /** Stages an image to draw on a page, or to draw in place of another. */
  registerInvoke('images:choose', async ({ sessionId }, event) => {
    const result = await dialog.showOpenDialog(deps.senderWindow(event), {
      title: 'Choose an image',
      buttonLabel: 'Use image',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }],
    });

    const chosen = result.canceled ? undefined : result.filePaths[0];
    if (chosen === undefined) return null;
    return deps.stagedAssets.stageImage(sessionId, chosen);
  });

  /**
   * Stages the picture on the clipboard. It is read here, in the main
   * process, so the renderer needs no clipboard permission and the pixels
   * never cross IPC.
   */
  registerInvoke('images:paste', async ({ sessionId }) => {
    const bytes = await clipboardPicture(await clipboard.read(), (other) => {
      const picture = nativeImage.createFromBuffer(Buffer.from(other));
      return picture.isEmpty() ? null : new Uint8Array(picture.toPNG());
    });
    if (bytes === null) return null;
    return deps.stagedAssets.stageImageBytes(sessionId, bytes, 'Pasted image');
  });

  /** Cuts an image down to its crop, and stages what is left to draw in its place. */
  registerInvoke('images:cut', async ({ sessionId, page, imageId, crop }) => {
    const document = await load(deps, sessionId);
    const placement = await imageOn(document, page, imageId);
    const cut = cropImagePixels(
      document,
      resourcesOf(document, document.getPage(page - 1)),
      placement.resourceName,
      crop,
      nativeImageCodec,
    );
    return {
      image: deps.stagedAssets.stageImageBytes(sessionId, cut.bytes, 'Cut image'),
      crop: cut.crop,
    };
  });

  /**
   * Writes an image out as the file the document holds: a JPEG untouched, and
   * anything else as a PNG of the samples themselves.
   */
  registerInvoke('images:export', async ({ sessionId, page, imageId }, event) => {
    const session = deps.documents.get(sessionId);
    if (session === undefined) {
      throw new AppError('internal/unexpected', { message: 'That document is no longer open.' });
    }

    const document = await load(deps, sessionId);
    const placement = await imageOn(document, page, imageId);

    const exported = exportImage(
      document,
      resourcesOf(document, document.getPage(page - 1)),
      placement.resourceName,
    );

    const stem = path.basename(session.file.displayName, path.extname(session.file.displayName));
    const suggested = `${stem} page ${String(page)} image.${exported.extension}`;
    const result = await dialog.showSaveDialog(deps.senderWindow(event), {
      title: 'Save the image',
      buttonLabel: 'Save',
      defaultPath: path.join(path.dirname(session.file.path), suggested),
      filters: [{ name: exported.extension.toUpperCase(), extensions: [exported.extension] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    if (result.canceled || result.filePath === undefined) return CANCELED;

    await writeFileAtomic(result.filePath, exported.bytes);
    return {
      canceled: false,
      paths: [result.filePath],
      directory: path.dirname(result.filePath),
    };
  });
}

async function load(deps: ImageHandlerDeps, sessionId: string): Promise<PDFDocument> {
  const bytes = await deps.editor.currentBytes(sessionId);
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (error) {
    throw new AppError('pdf/invalid', {
      message: 'That document could not be read for editing.',
      cause: error,
    });
  }
}

async function imageOn(
  document: PDFDocument,
  page: number,
  imageId: string,
): Promise<ImagePlacement> {
  if (page < 1 || page > document.getPageCount()) {
    throw new AppError('internal/unexpected', {
      message: 'That page is not in this document.',
      details: `page ${String(page)} of ${String(document.getPageCount())}`,
    });
  }
  const content = await readPageWithImages(document, page - 1);
  const placement = findImage(content, imageId);
  if (placement === undefined) {
    throw new AppError('pdf/malformed-content', {
      message: 'That image is no longer on the page.',
      details: `image ${imageId} on page ${String(page)}`,
    });
  }
  return placement;
}

function describeImage(placement: ImagePlacement): PageImageModel {
  return {
    id: imageIdOf(placement),
    resourceName: placement.resourceName,
    placement: placementOf(placement.matrix),
    crop: placement.crop,
    opacity: placement.opacity,
    pixelWidth: Math.round(placement.facts.width),
    pixelHeight: Math.round(placement.facts.height),
    hasAlpha: placement.facts.hasAlpha,
    added: isAddedImage(placement.resourceName),
  };
}
