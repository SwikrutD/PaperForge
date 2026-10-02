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

    if (operation.kind === 'applyRedactions') {
      const outside = operation.marks.filter((mark) => mark.page > pages);
      if (outside.length > 0) {
        throw new AppError('internal/unexpected', {
          message: 'A marked area belongs to a page this document does not have.',
          details: `applyRedactions: ${outside.length} of ${operation.marks.length} outside 1-${pages}`,
        });
      }
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
        ? `Add ${describeInput(operation.annotations[0])}`
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
    case 'addRecognisedText':
      return operation.pages.length === 1
        ? `Recognise text on page ${String(operation.pages[0]?.page ?? 1)}`
        : `Recognise text on ${String(operation.pages.length)} pages`;
    case 'addFormField':
      return `Add ${operation.name}`;
    case 'updateFormField':
      return `Change ${operation.name}`;
    case 'deleteFormField':
      return `Delete ${operation.name}`;
    case 'flattenFields':
      return operation.names === null ? 'Flatten the form' : 'Flatten fields';
    case 'flattenAnnotations':
      return operation.ids === null ? 'Flatten comments and signatures' : 'Flatten marks';
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
    case 'setMetadata':
      return 'Change document properties';
    case 'setDocumentLanguage':
      return operation.language === null ? 'Clear document language' : 'Set document language';
    case 'setDocumentTitle':
      return operation.title === null ? 'Clear document title' : 'Set document title';
    case 'setDisplayDocTitle':
      return operation.display
        ? 'Show the title in the title bar'
        : 'Show the file name in the title bar';
    case 'setAltText':
      return operation.alt === null ? 'Clear alternate text' : 'Set alternate text';
    case 'setFieldTooltips':
      return operation.fields.length === 1
        ? `Name ${operation.fields[0]?.name ?? 'field'}`
        : `Name ${String(operation.fields.length)} fields`;
    case 'setTabOrder':
      return 'Set the tab order to follow the tags';
    case 'addBookmark':
      return `Add bookmark "${shorten(operation.title)}"`;
    case 'updateBookmark':
      return operation.title !== null && operation.title !== operation.expectTitle
        ? `Rename bookmark to "${shorten(operation.title)}"`
        : `Change bookmark "${shorten(operation.expectTitle)}"`;
    case 'deleteBookmark':
      return `Delete bookmark "${shorten(operation.expectTitle)}"`;
    case 'moveBookmark':
      return `Move bookmark "${shorten(operation.expectTitle)}"`;
    case 'setLayerDefaults':
      return 'Set which layers show when the document opens';
    case 'addAttachments':
      return operation.tokens.length === 1 ? 'Attach a file' : 'Attach files';
    case 'removeAttachments':
      return operation.ids.length === 1 ? 'Remove an attachment' : 'Remove attachments';
    case 'sanitize':
      return 'Remove hidden information';
    case 'applyRedactions':
      return operation.marks.length === 1
        ? 'Apply a redaction'
        : `Apply ${String(operation.marks.length)} redactions`;
  }
}

function shorten(text: string): string {
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
}

function plural(pages: readonly number[]): string {
  return pages.length === 1 ? 'page' : 'pages';
}

/** What a new annotation is called, telling a measurement from a plain shape. */
export function describeInput(
  input: { geometry: { kind: AnnotationKind }; measure?: { kind: string } | undefined } | undefined,
): string {
  if (input?.measure !== undefined) return `${input.measure.kind} measurement`;
  return describeKind(input?.geometry.kind);
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
