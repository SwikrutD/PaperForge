import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFString,
} from 'pdf-lib';
import { AppError } from '@shared/errors/appError';
import type { PageBoxes } from '@shared/schemas/pages';
import { toLetters, toRoman } from '@shared/utils/pageLabels';

/**
 * Taking pages out of a document, and reading what each page says about its
 * own geometry.
 *
 * Extraction produces a new document rather than changing the one it came
 * from: the pages are copied, so what is written out stands on its own and the
 * original is not touched.
 */

/** A new document holding copies of the pages named, in that order. */
export async function extractPages(
  bytes: Uint8Array,
  pages: readonly number[],
): Promise<Uint8Array> {
  const source = await PDFDocument.load(bytes, { updateMetadata: false });
  const available = source.getPageCount();
  const wanted = pages.filter((page) => page >= 1 && page <= available);

  if (wanted.length === 0) {
    throw new AppError('internal/unexpected', {
      message: 'Those pages are not in this document.',
      details: `asked for ${pages.join(', ')} of ${available}`,
    });
  }

  const target = await PDFDocument.create();
  const copies = await target.copyPages(
    source,
    wanted.map((page) => page - 1),
  );
  for (const page of copies) target.addPage(page);

  // What the document says about itself travels with the pages.
  const info = source.getTitle();
  if (info !== undefined) target.setTitle(info);
  const author = source.getAuthor();
  if (author !== undefined) target.setAuthor(author);

  return target.save({ useObjectStreams: true });
}

function rectOf(array: PDFArray | undefined): PageBoxes['media'] | null {
  if (array === undefined || array.size() < 4) return null;
  const values: number[] = [];
  for (let index = 0; index < 4; index += 1) {
    const entry = array.lookup(index);
    values.push(entry instanceof PDFNumber ? entry.asNumber() : 0);
  }

  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = values;
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}

/** One page's boxes, as the page itself declares them. */
export async function readPageBoxes(bytes: Uint8Array): Promise<PageBoxes[]> {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  const labels = readPageLabels(document);

  return document.getPages().map((page, index) => {
    const node = page.node;
    const media = rectOf(node.MediaBox()) ?? { x: 0, y: 0, width: 612, height: 792 };

    return {
      pageNumber: index + 1,
      rotation: page.getRotation().angle,
      media,
      crop: rectOf(node.CropBox()),
      bleed: rectOf(node.BleedBox()),
      trim: rectOf(node.TrimBox()),
      art: rectOf(node.ArtBox()),
      label: labels[index] ?? null,
    };
  });
}

/**
 * The labels a document prints on its pages, worked out from `/PageLabels`.
 *
 * PDF.js does this when a document is open in the viewer; the main process
 * needs it too, for the page grid and for naming extracted files.
 */
export function readPageLabels(document: PDFDocument): Array<string | null> {
  const count = document.getPageCount();
  const labels: Array<string | null> = new Array<string | null>(count).fill(null);

  const tree = document.catalog.lookup(PDFName.of('PageLabels'));
  if (!(tree instanceof PDFDict)) return labels;
  const nums = tree.lookup(PDFName.of('Nums'));
  if (!(nums instanceof PDFArray)) return labels;

  const ranges: Array<{ from: number; style: string | null; prefix: string; start: number }> = [];
  for (let index = 0; index + 1 < nums.size(); index += 2) {
    const key = nums.lookup(index);
    const value = nums.lookup(index + 1);
    if (!(key instanceof PDFNumber) || !(value instanceof PDFDict)) continue;

    const style = value.lookup(PDFName.of('S'));
    const prefix = value.lookup(PDFName.of('P'));
    const start = value.lookup(PDFName.of('St'));

    ranges.push({
      from: key.asNumber(),
      style: style instanceof PDFName ? style.asString().replace(/^\//, '') : null,
      prefix:
        prefix instanceof PDFString
          ? prefix.asString()
          : prefix instanceof PDFHexString
            ? prefix.decodeText()
            : '',
      start: start instanceof PDFNumber ? start.asNumber() : 1,
    });
  }

  ranges.sort((a, b) => a.from - b.from);

  for (let index = 0; index < count; index += 1) {
    const range = [...ranges].reverse().find((entry) => entry.from <= index);
    if (range === undefined) continue;
    const position = range.start + (index - range.from);
    labels[index] = `${range.prefix}${numberIn(range.style, position)}`;
  }
  return labels;
}

/** A page number in the style its range asks for. */
function numberIn(style: string | null, value: number): string {
  switch (style) {
    case 'D':
      return String(value);
    case 'r':
      return toRoman(value).toLowerCase();
    case 'R':
      return toRoman(value);
    case 'a':
      return toLetters(value).toLowerCase();
    case 'A':
      return toLetters(value);
    default:
      // A range with no style is a prefix on its own, which is legal.
      return '';
  }
}
