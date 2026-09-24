import { AppError } from '@shared/errors/appError';
import type { AnnotationKind } from '@shared/schemas/annotation';
import type { EditOperation, EditTransaction } from '@shared/schemas/edit';

/**
 * Operation arithmetic, kept apart from any PDF library so it can be reasoned
 * about and tested on its own.
 */

/** Page numbers, sorted, de-duplicated and within the document. */
export function normalizePages(pages: readonly number[], pageCount: number): number[] {
  const unique = new Set<number>();
  for (const page of pages) {
    if (Number.isInteger(page) && page >= 1 && page <= pageCount) unique.add(page);
  }
  return [...unique].sort((a, b) => a - b);
}

/** Rotation a page ends up with, normalized to 0, 90, 180 or 270. */
export function rotationAfter(current: number, degrees: number): number {
  return (((Math.round((current + degrees) / 90) * 90) % 360) + 360) % 360;
}

/**
 * Checks a transaction against the document it will be applied to.
 *
 * Doing this before anything is written means a nonsensical edit is refused
 * with an explanation rather than producing a broken revision.
 */
export function validateTransaction(
  transaction: EditTransaction,
  pageCount: number,
): { operations: EditOperation[]; pageCount: number } {
  let pages = pageCount;
  const operations: EditOperation[] = [];

  for (const operation of transaction.operations) {
    if (operation.kind === 'rotatePages' || operation.kind === 'deletePages') {
      const targets = normalizePages(operation.pages, pages);
      if (targets.length === 0) {
        throw new AppError('internal/unexpected', {
          message: 'That change does not apply to any page of this document.',
          details: `${operation.kind}: no page of ${pages} matched ${operation.pages.join(', ')}`,
        });
      }

      if (operation.kind === 'deletePages') {
        if (targets.length >= pages) {
          throw new AppError('internal/unexpected', {
            message: 'A PDF must keep at least one page.',
            details: `deletePages would remove all ${pages} pages`,
          });
        }
        pages -= targets.length;
      }

      operations.push({ ...operation, pages: targets });
      continue;
    }

    if (
      operation.kind === 'movePages' ||
      operation.kind === 'duplicatePages' ||
      operation.kind === 'cropPages'
    ) {
      const targets = normalizePages(operation.pages, pages);
      if (targets.length === 0) {
        throw new AppError('internal/unexpected', {
          message: 'That change does not apply to any page of this document.',
          details: `${operation.kind}: no page of ${pages} matched`,
        });
      }
      if (operation.kind === 'duplicatePages') pages += targets.length;
      operations.push({ ...operation, pages: targets });
      continue;
    }

    if (operation.kind === 'insertBlankPages') {
      pages += operation.count;
    }

    if (operation.kind === 'insertImagePages') {
      pages += 1;
    }

    if (operation.kind === 'insertPages') {
      // How many pages arrive depends on the source, which only the engine
      // has; the count is corrected when the change is applied.
      pages += operation.pages?.length ?? 1;
    }

    if (operation.kind === 'addAnnotations') {
      const outside = operation.annotations.filter(
        (annotation) => annotation.pageNumber < 1 || annotation.pageNumber > pages,
      );
      if (outside.length > 0) {
        throw new AppError('internal/unexpected', {
          message: 'That comment belongs to a page this document does not have.',
          details: `addAnnotations: ${outside.length} of ${operation.annotations.length} outside 1-${pages}`,
        });
      }
    }

    operations.push(operation);
  }

  return { operations, pageCount: pages };
}

/** "Rotate page 3" / "Delete pages 2-4", for the Undo and Redo commands. */
export function describeOperation(operation: EditOperation): string {
  switch (operation.kind) {
    case 'rotatePages': {
      const direction =
        operation.degrees === 90 ? 'right' : operation.degrees === 270 ? 'left' : '180°';
      return `Rotate ${plural(operation.pages)} ${formatPageList(operation.pages)} ${direction}`;
    }
    case 'deletePages':
      return `Delete ${plural(operation.pages)} ${formatPageList(operation.pages)}`;
    case 'addAnnotations':
      return operation.annotations.length === 1
        ? `Add ${describeKind(operation.annotations[0]?.geometry.kind)}`
        : `Add ${String(operation.annotations.length)} comments`;
    case 'updateAnnotations':
      return operation.updates.length === 1 ? 'Change comment' : 'Change comments';
    case 'deleteAnnotations':
      return operation.ids.length === 1 ? 'Delete comment' : 'Delete comments';
    case 'movePages':
      return `Move ${plural(operation.pages)} ${formatPageList(operation.pages)}`;
    case 'duplicatePages':
      return `Duplicate ${plural(operation.pages)} ${formatPageList(operation.pages)}`;
    case 'insertBlankPages':
      return operation.count === 1
        ? 'Insert a blank page'
        : `Insert ${operation.count} blank pages`;
    case 'insertPages':
      return 'Insert pages';
    case 'insertImagePages':
      return 'Insert an image as a page';
    case 'cropPages':
      return `Crop ${plural(operation.pages)} ${formatPageList(operation.pages)}`;
    case 'setPageLabels':
      return 'Change page numbering';
    case 'editText':
      return operation.text === '' ? 'Delete text' : 'Edit text';
    case 'replaceText':
      return operation.text === '' ? 'Delete text' : 'Replace text';
    case 'addText':
      return 'Add text';
    case 'placeImage':
      return operation.token === null ? 'Move image' : 'Replace image';
    case 'deleteImage':
      return 'Delete image';
    case 'setFieldValues':
      return operation.values.length === 1
        ? `Fill ${operation.values[0]?.name ?? 'field'}`
        : `Fill ${String(operation.values.length)} fields`;
    case 'setWatermark':
      return 'Watermark';
    case 'setBackground':
      return 'Background';
    case 'setHeaderFooter':
      return 'Header and footer';
    case 'removeFurniture':
      return 'Remove watermark, background, header or footer';
    case 'addLink':
      return 'Add link';
    case 'updateLink':
      return operation.target === null ? 'Move link' : 'Change where a link goes';
    case 'deleteLink':
      return 'Delete link';
    case 'addImage':
      return 'Add image';
  }
}

function plural(pages: readonly number[]): string {
  return pages.length === 1 ? 'page' : 'pages';
}

/** The words a reader would use for an annotation kind. */
export function describeKind(kind: AnnotationKind | undefined): string {
  switch (kind) {
    case 'highlight':
      return 'highlight';
    case 'underline':
      return 'underline';
    case 'strikeOut':
      return 'strikethrough';
    case 'squiggly':
      return 'squiggly underline';
    case 'note':
      return 'sticky note';
    case 'freeText':
      return 'text box';
    case 'callout':
      return 'callout';
    case 'square':
      return 'rectangle';
    case 'circle':
      return 'ellipse';
    case 'line':
      return 'line';
    case 'arrow':
      return 'arrow';
    case 'polygon':
      return 'polygon';
    case 'polyline':
      return 'polyline';
    case 'ink':
      return 'drawing';
    case 'stamp':
      return 'stamp';
    case 'imageStamp':
      return 'image stamp';
    default:
      return 'comment';
  }
}

/** Collapses runs of consecutive pages: [1,2,3,7] becomes "1-3, 7". */
export function formatPageList(pages: readonly number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const parts: string[] = [];

  let index = 0;
  while (index < sorted.length) {
    const start = sorted[index] as number;
    let end = start;
    while (index + 1 < sorted.length && sorted[index + 1] === end + 1) {
      index += 1;
      end = sorted[index] as number;
    }
    parts.push(start === end ? String(start) : `${start}-${end}`);
    index += 1;
  }
  return parts.join(', ');
}
