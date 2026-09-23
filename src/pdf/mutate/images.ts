import type { PDFDocument } from 'pdf-lib';
import { AppError } from '@shared/errors/appError';
import type { EditOperation } from '@shared/schemas/edit';
import { appendImage, moveImage, removeImage } from '@pdf/content/editImage';
import { placementMatrix, type ImagePlacement } from '@pdf/content/images';
import { readPageContent, type PageContent } from '@pdf/content/pageContent';
import type { StagedAsset } from './types';
import { embedImage, readXObjects } from './imageResources';
import { setPageContent } from './text';

/**
 * Changing the images a page draws.
 *
 * Moving, resizing, turning and cropping all come to the same thing: the
 * image is drawn again with a different transform, in the place it was always
 * drawn, so it keeps its place in front of and behind everything else.
 */

/** How an image is named outside this process. */
export function imageIdOf(placement: ImagePlacement): string {
  return `img${String(placement.operationIndex)}`;
}

export function findImage(content: PageContent, imageId: string): ImagePlacement | undefined {
  return content.images.find((placement) => imageIdOf(placement) === imageId);
}

/** Reads a page with its images, which needs pdf-lib to see the resources. */
export function readPageWithImages(document: PDFDocument, pageIndex: number): Promise<PageContent> {
  return readPageContent(document, pageIndex, readXObjects);
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

    const embedded = await embedImage(document, page, asset.bytes, asset.format);
    setPageContent(
      document,
      pageIndex,
      appendImage(content.bytes, placementMatrix(operation.placement), embedded.name),
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

  if (operation.kind === 'deleteImage') {
    setPageContent(document, pageIndex, removeImage(content.bytes, placement));
    return true;
  }

  // A replacement is embedded first, so the same operation moves and replaces.
  let resourceName: string | undefined;
  if (operation.token !== null) {
    const asset = assets.get(operation.token);
    if (asset === undefined || asset.kind !== 'image') {
      throw new AppError('internal/unexpected', {
        message: 'That image is no longer available to put there.',
        details: `no staged image for ${operation.token}`,
      });
    }
    resourceName = (await embedImage(document, page, asset.bytes, asset.format)).name;
  }

  const moved = moveImage(content.bytes, placement, {
    matrix: placementMatrix(operation.placement),
    crop: operation.crop,
    ...(resourceName === undefined ? {} : { resourceName }),
  });

  if (moved === null) {
    throw new AppError('pdf/malformed-content', {
      message: 'PaperForge cannot move that image: the page draws it in a way it cannot undo.',
      details: `image ${operation.imageId} on page ${String(operation.page)}`,
    });
  }

  setPageContent(document, pageIndex, moved);
  return true;
}
