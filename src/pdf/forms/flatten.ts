import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFStream,
  type PDFDocument,
  type PDFPage,
} from 'pdf-lib';
import { AppError } from '@shared/errors/appError';
import { contentBytes } from '@pdf/content/pageContent';
import { readAnnotations } from '@pdf/mutate/annotations/read';
import { setPageContent } from '@pdf/mutate/text';
import { refreshAppearances } from './write';

/**
 * Flattening: turning a field or a mark into part of the page.
 *
 * What a reader sees does not change — the appearance the annotation already
 * carries is drawn onto the page exactly as it was — but it stops being a
 * thing that can be filled in, moved or taken off. That is what makes it
 * worth warning about, and why PaperForge does it to a copy by default.
 */

export interface FlattenResult {
  /** How many fields or marks were turned into page content. */
  flattened: number;
}

/** Draws the chosen fields onto their pages and takes them out of the form. */
export async function flattenFields(
  document: PDFDocument,
  names: readonly string[] | null,
): Promise<FlattenResult> {
  // What is drawn must be what the field holds, so anything left unpainted is
  // painted before it is frozen.
  await refreshAppearances(document);

  const form = document.getForm();
  const fields =
    names === null
      ? form.getFields()
      : names
          .map((name) => form.getFieldMaybe(name))
          .filter((field): field is NonNullable<typeof field> => field !== undefined);

  const pages = document.getPages();
  let flattened = 0;

  for (const field of fields) {
    for (const widget of field.acroField.getWidgets()) {
      const appearance = normalAppearance(document, widget.dict);
      const page = pages.find((candidate) => candidate.ref === widget.P());
      if (appearance === null || page === undefined) continue;
      if (drawAppearance(document, page, appearance, widget.getRectangle())) flattened += 1;
    }
    form.removeField(field);
  }

  return { flattened };
}

/** Draws the chosen marks onto their pages and takes them off as annotations. */
export function flattenAnnotations(
  document: PDFDocument,
  ids: readonly string[] | null,
): FlattenResult {
  const wanted = ids === null ? null : new Set(ids);
  const pages = document.getPages();
  let flattened = 0;

  for (const record of readAnnotations(document)) {
    if (wanted !== null && !wanted.has(record.annotation.id)) continue;

    const page = pages[record.pageIndex];
    if (page === undefined) continue;

    const appearance = normalAppearance(document, record.dict);
    const rect = rectangleOf(record.dict);
    if (appearance === null || rect === null) continue;
    if (!drawAppearance(document, page, appearance, rect)) continue;

    page.node.removeAnnot(PDFRef.of(refNumber(record.ref), refGeneration(record.ref)));
    flattened += 1;
  }

  return { flattened };
}

/** `12 0 R` as its parts, which is how a record names its annotation. */
function refNumber(ref: string): number {
  return Number.parseInt(ref.split(' ')[0] ?? '0', 10);
}

function refGeneration(ref: string): number {
  return Number.parseInt(ref.split(' ')[1] ?? '0', 10);
}

/** The appearance an annotation shows normally, whatever state it is in. */
function normalAppearance(document: PDFDocument, dict: PDFDict): PDFRef | null {
  const appearances = dict.lookup(PDFName.of('AP'));
  if (!(appearances instanceof PDFDict)) return null;

  const normal = appearances.get(PDFName.of('N'));
  if (normal instanceof PDFRef) {
    const resolved = document.context.lookup(normal);
    if (resolved instanceof PDFStream) return normal;

    // A dictionary of states: the one named by `/AS` is the one on show.
    if (resolved instanceof PDFDict) return stateAppearance(resolved, dict);
    return null;
  }

  const direct = appearances.lookup(PDFName.of('N'));
  return direct instanceof PDFDict ? stateAppearance(direct, dict) : null;
}

function stateAppearance(states: PDFDict, dict: PDFDict): PDFRef | null {
  const state = dict.lookup(PDFName.of('AS'));
  const chosen = state instanceof PDFName ? states.get(state) : undefined;
  if (chosen instanceof PDFRef) return chosen;

  const first = states.entries()[0]?.[1];
  return first instanceof PDFRef ? first : null;
}

function rectangleOf(
  dict: PDFDict,
): { x: number; y: number; width: number; height: number } | null {
  const array = dict.lookup(PDFName.of('Rect'));
  if (!(array instanceof PDFArray) || array.size() < 4) return null;

  const values = [0, 1, 2, 3].map((index) => {
    const value = array.lookup(index);
    return value instanceof PDFNumber ? value.asNumber() : Number.NaN;
  });
  if (values.some((value) => !Number.isFinite(value))) return null;

  const [first = 0, second = 0, third = 0, fourth = 0] = values;
  return {
    x: Math.min(first, third),
    y: Math.min(second, fourth),
    width: Math.abs(third - first),
    height: Math.abs(fourth - second),
  };
}

/**
 * Draws an appearance stream onto a page, in the rectangle it belongs in.
 *
 * An appearance is a form whose own box may be anywhere and turned any way;
 * the PDF specification says to map that box onto the annotation's rectangle,
 * and that is what the transform written here does.
 */
function drawAppearance(
  document: PDFDocument,
  page: PDFPage,
  appearance: PDFRef,
  rect: { x: number; y: number; width: number; height: number },
): boolean {
  const stream = document.context.lookup(appearance);
  if (!(stream instanceof PDFStream) || rect.width <= 0 || rect.height <= 0) return false;

  const box = boundsOfForm(stream.dict);
  if (box === null || box.width <= 0 || box.height <= 0) return false;

  const scaleX = rect.width / box.width;
  const scaleY = rect.height / box.height;
  const name = page.node.newXObject('PFFlat', appearance);

  const block = [
    '\nq',
    `${format(scaleX)} 0 0 ${format(scaleY)} ${format(rect.x - box.x * scaleX)} ${format(
      rect.y - box.y * scaleY,
    )} cm`,
    `/${name.asString().replace('/', '')} Do`,
    'Q\n',
  ].join('\n');

  const existing = contentBytes(document, page);
  const appended = new Uint8Array(existing.length + block.length);
  appended.set(existing, 0);
  appended.set(latin1(block), existing.length);

  const index = document.getPages().indexOf(page);
  if (index < 0) {
    throw new AppError('internal/unexpected', {
      message: 'That page is no longer in this document.',
    });
  }
  setPageContent(document, index, appended);
  return true;
}

/** The box a form occupies once its own matrix has been applied. */
function boundsOfForm(
  dict: PDFDict,
): { x: number; y: number; width: number; height: number } | null {
  const bbox = dict.lookup(PDFName.of('BBox'));
  if (!(bbox instanceof PDFArray) || bbox.size() < 4) return null;

  const values = [0, 1, 2, 3].map((index) => {
    const value = bbox.lookup(index);
    return value instanceof PDFNumber ? value.asNumber() : Number.NaN;
  });
  if (values.some((value) => !Number.isFinite(value))) return null;
  const [left = 0, bottom = 0, right = 0, top = 0] = values;

  const matrix = matrixOf(dict);
  const corners = [
    apply(matrix, left, bottom),
    apply(matrix, right, bottom),
    apply(matrix, left, top),
    apply(matrix, right, top),
  ];
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

type Matrix = [number, number, number, number, number, number];

function matrixOf(dict: PDFDict): Matrix {
  const matrix = dict.lookup(PDFName.of('Matrix'));
  if (!(matrix instanceof PDFArray) || matrix.size() < 6) return [1, 0, 0, 1, 0, 0];

  const values = [0, 1, 2, 3, 4, 5].map((index) => {
    const value = matrix.lookup(index);
    return value instanceof PDFNumber ? value.asNumber() : Number.NaN;
  });
  return values.some((value) => !Number.isFinite(value)) ? [1, 0, 0, 1, 0, 0] : (values as Matrix);
}

function apply(matrix: Matrix, x: number, y: number): { x: number; y: number } {
  const [a, b, c, d, e, f] = matrix;
  return { x: a * x + c * y + e, y: b * x + d * y + f };
}

function format(value: number): string {
  return (Math.round(value * 1_000_000) / 1_000_000).toString();
}

function latin1(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index) & 0xff;
  return bytes;
}
