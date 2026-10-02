import { PDFDict, PDFName, PDFRef, type PDFDocument, type PDFPage } from 'pdf-lib';
import { AppError } from '@shared/errors/appError';
import type { EditOperation } from '@shared/schemas/edit';
import type { RasterPage, RedactionAppearance } from '@shared/schemas/redaction';
import { DEFAULT_TEXT_STYLE } from '@shared/schemas/text';
import { spliceBytes } from '../content/editText';
import { readPageFonts } from '../content/fonts';
import { resourcesOf } from '../content/pageContent';
import { parseContent } from '../content/parser';
import { extractTextRuns } from '../content/textRuns';
import { formatNumber, formatValue, nameOf } from '../content/values';
import { setPageContent } from '../mutate/text';
import { ensureFontResource, standardFont } from '../mutate/textResources';
import type { StagedAsset } from '../mutate/types';
import { toWinAnsi } from '../text/layout';
import { annotationsUnder, removeAnnotations } from './annotations';
import { collectGarbage, retireXObjects } from './garbage';
import { findGraphics } from './graphics';
import { analyzePage, xobjectsOf, type PageAnalysis } from './page';
import { paintOver, readRepaintable, writeRepainted } from './pixels';
import {
  glyphBoxes,
  glyphCovered,
  runMeasurable,
  unmeasurableRunTouches,
  type ContentEdit,
} from './text';
import type { Rect } from './geometry';

/**
 * Applying redactions.
 *
 * For each marked page: what lies under the marks is cut out of the page's
 * drawing (or the page is replaced by a picture the window drew with the
 * marks already painted on), comments and fields under the marks go, and a
 * box is painted where the content was. The page is then read again and
 * checked: if anything is still under a mark, the whole change is refused
 * rather than handed back half-done. Last, whatever the document no longer
 * reaches is deleted, so none of it travels into the saved file.
 */

type ApplyRedactions = Extract<EditOperation, { kind: 'applyRedactions' }>;
type MarkInput = ApplyRedactions['marks'][number];

/** Names a picture PaperForge repainted, or a page it drew as one. */
const REPAINTED_PREFIX = 'PFRedacted';
const PAGE_PICTURE = 'PFRedactedPage';
const TAG = 'PFRedaction';

export async function applyRedactionOperation(
  document: PDFDocument,
  operation: EditOperation,
  assets: ReadonlyMap<string, StagedAsset>,
): Promise<boolean> {
  if (operation.kind !== 'applyRedactions') return false;
  await applyRedactions(document, operation, assets);
  return true;
}

export async function applyRedactions(
  document: PDFDocument,
  operation: Omit<ApplyRedactions, 'kind'>,
  assets: ReadonlyMap<string, StagedAsset>,
): Promise<void> {
  const byPage = new Map<number, MarkInput[]>();
  for (const mark of operation.marks) {
    byPage.set(mark.page, [...(byPage.get(mark.page) ?? []), mark]);
  }
  const rasters = new Map(operation.rasterPages.map((raster) => [raster.page, raster]));
  for (const page of rasters.keys()) {
    if (!byPage.has(page)) {
      throw new AppError('redact/failed', {
        message: 'A page was drawn as a picture without anything marked on it.',
        details: `page ${String(page)}`,
      });
    }
  }

  const retired = new Set<string>();
  for (const [pageNumber, marks] of [...byPage].sort(([first], [second]) => first - second)) {
    const pageIndex = pageNumber - 1;
    if (pageIndex < 0 || pageIndex >= document.getPageCount()) {
      throw new AppError('redact/failed', {
        message: 'A marked area belongs to a page this document does not have.',
        details: `page ${String(pageNumber)} of ${String(document.getPageCount())}`,
      });
    }
    const page = document.getPage(pageIndex);
    const rects = marks.flatMap((mark) => mark.rects);
    const analysis = await analyzePage(document, pageIndex, rects);
    const before = drawnXObjects(document, page, analysis.content.bytes);

    takeOwnResources(document, page);
    const raster = rasters.get(pageNumber);
    let bytes: Uint8Array;
    if (raster !== undefined) {
      bytes = await pageAsPicture(document, page, raster, assets);
    } else {
      if (analysis.raster.length > 0) {
        throw new AppError('redact/failed', {
          message: `Page ${String(pageNumber)} cannot be redacted without drawing it as a picture.`,
          details: analysis.raster.join(' '),
        });
      }
      const repainted = repaint(document, page, analysis, rects, operation.appearance);
      bytes = applyEdits(analysis.content.bytes, [...analysis.edits, ...repainted]);
    }

    await verify(document, page, pageNumber, bytes, rects);
    removeAnnotations(document, page, annotationsUnder(document, page, rects));

    const after = drawnXObjects(document, page, bytes);
    for (const ref of before.values()) if (![...after.values()].includes(ref)) retired.add(ref);
    keepOnlyDrawn(document, page, after);

    setPageContent(
      document,
      pageIndex,
      await paintBoxes(document, page, bytes, marks, operation.appearance),
    );
    // A saved thumbnail is a picture of the page as it was.
    page.node.delete(PDFName.of('Thumb'));
  }

  retireXObjects(document, retired);
  collectGarbage(document);
}

/**
 * Gives the page resources of its own, so names can be added and taken away
 * without touching another page that shares them.
 */
function takeOwnResources(document: PDFDocument, page: PDFPage): void {
  const { context } = document;
  const current = resourcesOf(document, page);
  const own = current === undefined ? context.obj({}) : current.clone(context);
  const xobjects = context.lookupMaybe(own.get(PDFName.of('XObject')), PDFDict);
  if (xobjects !== undefined) own.set(PDFName.of('XObject'), xobjects.clone(context));
  page.node.set(PDFName.of('Resources'), own);
}

/** Repaints the pictures a mark only partly covers, returning the renames. */
function repaint(
  document: PDFDocument,
  page: PDFPage,
  analysis: PageAnalysis,
  rects: readonly Rect[],
  appearance: RedactionAppearance,
): ContentEdit[] {
  if (analysis.repaints.length === 0) return [];
  const xobjects = xobjectsOf(document, page);
  const dict = xobjectDictionary(document, page);

  return analysis.repaints.map((target) => {
    const stream = xobjects.get(target.name)?.stream;
    const image = stream === undefined ? 'missing' : readRepaintable(document, stream);
    const samples =
      typeof image === 'string' ? null : paintOver(image, target.ctm, rects, appearance.fill);
    if (typeof image === 'string' || samples === null) {
      throw new AppError('redact/failed', {
        message: 'A picture under a mark could not be repainted.',
        details: target.name,
      });
    }
    const name = freeName(dict, REPAINTED_PREFIX);
    dict.set(PDFName.of(name), writeRepainted(document, image, samples));
    return { range: target.nameRange, replacement: `/${name}` };
  });
}

/** Replaces the page's drawing with the picture the window made of it. */
async function pageAsPicture(
  document: PDFDocument,
  page: PDFPage,
  raster: RasterPage,
  assets: ReadonlyMap<string, StagedAsset>,
): Promise<Uint8Array> {
  const asset = assets.get(raster.token);
  if (asset?.kind !== 'image') {
    throw new AppError('redact/failed', {
      message: 'The picture of a page to redact is no longer available; try again.',
      details: `page ${String(raster.page)}`,
    });
  }
  const image =
    asset.format === 'png'
      ? await document.embedPng(asset.bytes)
      : await document.embedJpg(asset.bytes);

  // Nothing the page drew before is kept: not its fonts, not its pictures.
  page.node.set(
    PDFName.of('Resources'),
    document.context.obj({ XObject: { [PAGE_PICTURE]: image.ref } }),
  );
  const [x1, y1, x2, y2] = raster.viewBox;
  const drawing = `q ${formatNumber(x2 - x1)} 0 0 ${formatNumber(y2 - y1)} ${formatNumber(
    x1,
  )} ${formatNumber(y1)} cm /${PAGE_PICTURE} Do Q\n`;
  return latin1(drawing);
}

/** Applies edits that do not overlap, back to front. */
function applyEdits(bytes: Uint8Array, edits: readonly ContentEdit[]): Uint8Array {
  const ordered = [...edits].sort((first, second) => second.range.start - first.range.start);
  for (let index = 1; index < ordered.length; index += 1) {
    const later = ordered[index - 1];
    const earlier = ordered[index];
    if (later !== undefined && earlier !== undefined && earlier.range.end > later.range.start) {
      throw new AppError('redact/failed', {
        message: 'This page is drawn in a way PaperForge cannot cut safely.',
        details: 'overlapping content edits',
      });
    }
  }
  let result = bytes;
  for (const edit of ordered) result = spliceBytes(result, edit.range, edit.replacement);
  return result;
}

/**
 * Reads the cut page back and refuses the change if anything is still under a
 * mark: a glyph, a picture that was not repainted, or a group.
 */
async function verify(
  document: PDFDocument,
  page: PDFPage,
  pageNumber: number,
  bytes: Uint8Array,
  rects: readonly Rect[],
): Promise<void> {
  const operations = parseContent(bytes);
  const fonts = await readPageFonts(document, resourcesOf(document, page));
  const runs = extractTextRuns(operations, { fonts: (name) => fonts.get(name) });

  const textLeft = runs.some((run) =>
    runMeasurable(run)
      ? glyphBoxes(run).some((box) => glyphCovered(box, rects))
      : unmeasurableRunTouches(run, rects),
  );
  // What PaperForge drew itself — a repainted picture, or the whole page as
  // one — was drawn with the marks already painted on.
  const xobjects = xobjectsOf(document, page);
  const graphics = findGraphics(
    operations,
    rects,
    (name) => (name.startsWith(REPAINTED_PREFIX) ? undefined : xobjects.get(name)?.info),
    () => 'not repainted',
  );

  if (textLeft || graphics.raster.length > 0 || graphics.edits.length > 0) {
    throw new AppError('redact/failed', {
      message: `PaperForge could not confirm that everything under the marks on page ${String(
        pageNumber,
      )} was removed, so nothing was changed.`,
      details: textLeft ? 'text remains under a mark' : 'a drawing remains under a mark',
    });
  }
}

/** The pictures and groups a drawing uses, by name, as references. */
function drawnXObjects(
  document: PDFDocument,
  page: PDFPage,
  bytes: Uint8Array,
): Map<string, string> {
  const dict = document.context.lookupMaybe(
    resourcesOf(document, page)?.get(PDFName.of('XObject')),
    PDFDict,
  );
  const drawn = new Map<string, string>();
  if (dict === undefined) return drawn;
  for (const operation of parseContent(bytes)) {
    if (operation.operator !== 'Do') continue;
    const name = nameOf(operation.operands[0]);
    const value = name === null ? undefined : dict.get(PDFName.of(name));
    if (name !== null && value instanceof PDFRef) drawn.set(name, value.toString());
  }
  return drawn;
}

/** Takes names the page no longer draws out of its own resources. */
function keepOnlyDrawn(
  document: PDFDocument,
  page: PDFPage,
  drawn: ReadonlyMap<string, string>,
): void {
  const dict = document.context.lookupMaybe(
    resourcesOf(document, page)?.get(PDFName.of('XObject')),
    PDFDict,
  );
  for (const [key] of dict?.entries() ?? []) {
    if (!drawn.has(key.decodeText())) dict?.delete(key);
  }
}

function xobjectDictionary(document: PDFDocument, page: PDFPage): PDFDict {
  const resources = resourcesOf(document, page) ?? document.context.obj({});
  const existing = document.context.lookupMaybe(resources.get(PDFName.of('XObject')), PDFDict);
  if (existing !== undefined) return existing;
  const created = document.context.obj({});
  resources.set(PDFName.of('XObject'), created);
  return created;
}

function freeName(dict: PDFDict, prefix: string): string {
  let index = 1;
  while (dict.has(PDFName.of(`${prefix}${String(index)}`))) index += 1;
  return `${prefix}${String(index)}`;
}

/**
 * Paints the boxes over where the content was, and the reason on each where
 * the reader asked for it and there is room. The page's own drawing is
 * wrapped in `q`/`Q` first, so nothing it leaves set can move the boxes.
 */
async function paintBoxes(
  document: PDFDocument,
  page: PDFPage,
  bytes: Uint8Array,
  marks: readonly MarkInput[],
  appearance: RedactionAppearance,
): Promise<Uint8Array> {
  const { r, g, b } = appearance.fill;
  const lines = [`/${TAG} BMC`, 'q', `${formatNumber(r)} ${formatNumber(g)} ${formatNumber(b)} rg`];
  for (const rect of marks.flatMap((mark) => mark.rects)) {
    lines.push(
      `${formatNumber(round(rect.x))} ${formatNumber(round(rect.y))} ${formatNumber(
        round(rect.width),
      )} ${formatNumber(round(rect.height))} re f`,
    );
  }

  if (appearance.showReason && marks.some((mark) => (mark.reason ?? '') !== '')) {
    const resource = await ensureFontResource(document, page, DEFAULT_TEXT_STYLE);
    const font = await standardFont(document, DEFAULT_TEXT_STYLE);
    // Light text on a dark box, dark text on a light one.
    const ink = 0.299 * r + 0.587 * g + 0.114 * b < 0.5 ? 1 : 0;
    for (const mark of marks) {
      const reason = toWinAnsi(mark.reason ?? '').trim();
      if (reason === '') continue;
      for (const rect of mark.rects) {
        const size = Math.min(10, rect.height * 0.7);
        if (size < 4) continue;
        const text = fitted(reason, rect.width - 4, (value) => widthOf(font, value, size));
        if (text === '') continue;
        lines.push(
          'BT',
          `${String(ink)} g`,
          `/${resource} ${formatNumber(round(size))} Tf`,
          `${formatNumber(round(rect.x + 2))} ${formatNumber(
            round(rect.y + (rect.height - size * 0.7) / 2),
          )} Td`,
          `${formatValue({ kind: 'string', bytes: latin1(text), hex: false })} Tj`,
          'ET',
        );
      }
    }
  }
  lines.push('Q', 'EMC');

  const wrapped = spliceBytes(bytes, { start: 0, end: 0 }, 'q\n');
  return spliceBytes(
    wrapped,
    { start: wrapped.length, end: wrapped.length },
    `\nQ\n${lines.join('\n')}\n`,
  );
}

/** As much of the text as fits the width, cut at a character. */
function fitted(text: string, width: number, measure: (value: string) => number): string {
  let result = text;
  while (result !== '' && measure(result) > width) result = result.slice(0, -1);
  return result;
}

function widthOf(
  font: { widthOfTextAtSize: (text: string, size: number) => number },
  text: string,
  size: number,
): number {
  try {
    return font.widthOfTextAtSize(text, size);
  } catch {
    return text.length * size * 0.5;
  }
}

function latin1(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index) & 0xff;
  return bytes;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
