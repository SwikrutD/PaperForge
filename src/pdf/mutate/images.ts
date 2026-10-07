import type { PDFDict, PDFDocument } from 'pdf-lib';
import { AppError } from '@shared/errors/appError';
import type { EditOperation } from '@shared/schemas/edit';
import { appendImage, moveImage, removeImage } from '@pdf/content/editImage';
import { placementMatrix, type ImagePlacement } from '@pdf/content/images';
import type { Matrix } from '@pdf/content/state';
import { readPageContent, type PageContent } from '@pdf/content/pageContent';
import type { StagedAsset } from './types';
import {
  embedImage,
  embedImageObject,
  ensureAlphaResource,
  ensureAlphaIn,
  nameImageIn,
  ownResources,
  readAlphas,
  readXObjects,
} from './imageResources';
import { editInForm, formOpener, resourcesForImage } from './formImages';
import { inlineImageStream } from './inlineImages';

export { formUsesOf } from './formImages';
import { setPageContent } from './text';

/**
 * Changing the images a page draws.
 *
 * Moving, resizing, turning and cropping all come to the same thing: the
 * image is drawn again with a different transform, in the place it was always
 * drawn, so it keeps its place in front of and behind everything else.
 */

/**
 * How an image is named outside this process.
 *
 * One PaperForge added carries its name in the page; any other is named by
 * where it is drawn, which holds only until the page's content next changes.
 */
export function imageIdOf(placement: ImagePlacement): string {
  if (placement.mark !== null) return placement.mark.id;
  // Inside a form, the drawings of the forms on the way down say which one.
  const forms = placement.forms.map((step) => `f${String(step.operationIndex)}-`).join('');
  return `${forms}img${String(placement.operationIndex)}`;
}

/** A fresh id for an image PaperForge adds. */
export function newImageId(): string {
  return `pf-${globalThis.crypto.randomUUID()}`;
}

export function findImage(content: PageContent, imageId: string): ImagePlacement | undefined {
  return content.images.find((placement) => imageIdOf(placement) === imageId);
}

/**
 * Where a picture can be read from, by resource name: the innermost form's
 * resources, or the page's. An inline picture has no resource, so one is made
 * for it — registered in the document, which is why this is only for reading
 * (exporting, cutting) from a copy that is then thrown away.
 */
export function pictureSource(
  document: PDFDocument,
  pageIndex: number,
  placement: ImagePlacement,
): { resources: PDFDict | undefined; resourceName: string } {
  const resources = resourcesForImage(document, pageIndex, placement);
  if (placement.inline === null) return { resources, resourceName: placement.resourceName };
  const ref = document.context.register(inlineImageStream(document, placement.inline, resources));
  return { resources: document.context.obj({ XObject: { Inline: ref } }), resourceName: 'Inline' };
}

/** Reads a page with its images, which needs pdf-lib to see the resources. */
export function readPageWithImages(document: PDFDocument, pageIndex: number): Promise<PageContent> {
  return readPageContent(document, pageIndex, (target, resources) => ({
    images: readXObjects(target, resources),
    alphas: readAlphas(target, resources),
    openForm: formOpener(target, resources),
  }));
}

/** Applies an image operation; returns false when it is not one. */
export async function applyImageOperation(
  document: PDFDocument,
  operation: EditOperation,
  assets: ReadonlyMap<string, StagedAsset>,
): Promise<boolean> {
  if (
    operation.kind !== 'placeImage' &&
    operation.kind !== 'deleteImage' &&
    operation.kind !== 'addImage'
  ) {
    return false;
  }

  const pageIndex = operation.page - 1;
  if (pageIndex < 0 || pageIndex >= document.getPageCount()) {
    throw new AppError('internal/unexpected', {
      message: 'That page is not in this document any more.',
      details: `page ${String(operation.page)} of ${String(document.getPageCount())}`,
    });
  }

  const page = document.getPage(pageIndex);
  const content = await readPageWithImages(document, pageIndex);

  if (operation.kind === 'addImage') {
    const asset = assets.get(operation.token);
    if (asset === undefined || asset.kind !== 'image') {
      throw new AppError('internal/unexpected', {
        message: 'That image is no longer available to add.',
        details: `no staged image for ${operation.token}`,
      });
    }

    const imageId = operation.imageId ?? newImageId();
    if (findImage(content, imageId) !== undefined) {
      throw new AppError('internal/unexpected', {
        message: 'That page already has an image by that name.',
        details: imageId,
      });
    }

    const embedded = await embedImage(document, page, asset.bytes, asset.format);
    const alpha =
      operation.opacity >= 1 ? undefined : ensureAlphaResource(document, page, operation.opacity);
    setPageContent(
      document,
      pageIndex,
      appendImage(
        content.bytes,
        placementMatrix(operation.placement),
        embedded.name,
        alpha,
        imageId,
      ),
    );
    return true;
  }

  const placement = findImage(content, operation.imageId);
  if (placement === undefined) {
    throw new AppError('pdf/malformed-content', {
      message: 'That image is no longer where it was; close the editor and try again.',
      details: `image ${operation.imageId} on page ${String(operation.page)}`,
    });
  }

  // The stream that draws the picture: the page's own, or a form's.
  const rewrite = (
    change: (bytes: Uint8Array, resources: () => PDFDict) => Uint8Array | null,
    grow: Matrix | null,
  ): boolean => {
    if (placement.forms.length === 0) {
      const changed = change(content.bytes, () => ownResources(document, page));
      if (changed === null) return false;
      setPageContent(document, pageIndex, changed);
      return true;
    }
    return editInForm(
      document,
      pageIndex,
      placement,
      operation.scope ?? 'this',
      (target) => change(target.bytes, target.resources),
      grow,
    );
  };

  if (operation.kind === 'deleteImage') {
    rewrite((bytes) => removeImage(bytes, placement), null);
    return true;
  }

  // A replacement is staged first, so the same operation moves and replaces.
  let replacement: StagedAsset | undefined;
  if (operation.token !== null) {
    replacement = assets.get(operation.token);
    if (replacement === undefined || replacement.kind !== 'image') {
      throw new AppError('internal/unexpected', {
        message: 'That image is no longer available to put there.',
        details: `no staged image for ${operation.token}`,
      });
    }
  }
  // Embedding is asynchronous and the rewrite is not, so the picture is
  // embedded up front and named in whichever resources end up drawing it.
  const embedded =
    replacement?.kind === 'image'
      ? await embedImageObject(document, replacement.bytes, replacement.format)
      : undefined;

  const matrix = placementMatrix(operation.placement);
  const moved = rewrite((bytes, resources) => {
    const resourceName =
      embedded === undefined ? undefined : nameImageIn(document, resources(), embedded.ref);
    // A picture going back to solid needs saying so when the page faded it.
    const alphaName =
      operation.opacity < 1 || placement.opacity < 1
        ? ensureAlphaIn(document, resources(), operation.opacity)
        : undefined;
    return moveImage(bytes, placement, {
      matrix,
      crop: operation.crop,
      ...(resourceName === undefined ? {} : { resourceName }),
      ...(alphaName === undefined ? {} : { alphaName }),
    });
  }, matrix);

  if (!moved) {
    throw new AppError('pdf/malformed-content', {
      message: 'PaperForge cannot move that image: the page draws it in a way it cannot undo.',
      details: `image ${operation.imageId} on page ${String(operation.page)}`,
    });
  }
  return true;
}
