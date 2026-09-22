import { AppError } from '@shared/errors/appError';
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
  }

  return { operations, pageCount: pages };
}

/** "Rotate page 3" / "Delete pages 2-4", for the Undo and Redo commands. */
export function describeOperation(operation: EditOperation): string {
  const pages = formatPageList(operation.pages);
  const plural = operation.pages.length === 1 ? 'page' : 'pages';
  if (operation.kind === 'rotatePages') {
    const direction =
      operation.degrees === 90 ? 'right' : operation.degrees === 270 ? 'left' : '180°';
    return `Rotate ${plural} ${pages} ${direction}`;
  }
  return `Delete ${plural} ${pages}`;
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
