import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  decodePDFRawStream,
  type PDFDocument,
  type PDFObject,
  type PDFPage,
} from 'pdf-lib';
import type { ContentOperation } from '../content/parser';
import { readPageContent, resourcesOf, type PageContent } from '../content/pageContent';
import type { Matrix } from '../content/state';
import type { TextRun } from '../content/textRuns';
import { formatValue, type ContentValue } from '../content/values';
import { findGraphics, type Repaint, type XObjectInfo } from './graphics';
import { readRepaintable } from './pixels';
import {
  cutRun,
  glyphBoxes,
  glyphCovered,
  runMeasurable,
  unmeasurableRunTouches,
  type ContentEdit,
  type GlyphBox,
} from './text';
import type { Rect } from './geometry';

/**
 * Reading a page for redaction: what lies under its marks, and whether all of
 * it can be cut out of the page's own drawing.
 *
 * Nothing is changed here. The result says which bytes to rewrite, which
 * pictures to repaint and — when a page holds something PaperForge cannot cut
 * safely — why the page has to become a picture instead.
 */

export interface RemovedGlyph {
  text: string;
  box: GlyphBox;
  /** The show operation it came from, so neighbouring runs can be told apart. */
  operationIndex: number;
}

export interface PageAnalysis {
  pageIndex: number;
  content: PageContent;
  edits: ContentEdit[];
  repaints: Repaint[];
  /** Why the page cannot be cut natively; empty when it can. */
  raster: string[];
  removed: RemovedGlyph[];
  /** Where each picture or group a mark takes was drawn. */
  affected: Rect[];
}

const REASONS = {
  unreadable:
    'Part of this page is stored in a way PaperForge cannot read, so it cannot show that nothing is left under the marks.',
  unmeasured:
    'Some text under a mark is drawn in a font that does not say where its characters sit.',
  uncut: 'Some text under a mark is written in a way PaperForge cannot take apart safely.',
} as const;

const TEXT_KEYS = ['ActualText', 'Alt', 'E'] as const;

export async function analyzePage(
  document: PDFDocument,
  pageIndex: number,
  marks: readonly Rect[],
): Promise<PageAnalysis> {
  const page = document.getPage(pageIndex);
  const content = await readPageContent(document, pageIndex);
  const analysis: PageAnalysis = {
    pageIndex,
    content,
    edits: [],
    repaints: [],
    raster: [],
    removed: [],
    affected: [],
  };
  const raster = new Set<string>();
  if (!contentReadable(document, page)) raster.add(REASONS.unreadable);

  const cutOperations = new Set<number>();
  for (const run of content.runs) {
    const cut = cutText(run, content.operations, marks, analysis.removed);
    if (cut === 'untouched') continue;
    if (cut === 'unmeasured' || cut === 'uncut') {
      raster.add(REASONS[cut]);
      continue;
    }
    analysis.edits.push(cut);
    cutOperations.add(run.operationIndex);
  }
  analysis.edits.push(...describedText(content.operations, cutOperations));

  const xobjects = xobjectsOf(document, page);
  const graphics = findGraphics(
    content.operations,
    marks,
    (name) => xobjects.get(name)?.info,
    (name) => {
      const stream = xobjects.get(name)?.stream;
      if (stream === undefined) return 'A picture under a mark could not be read.';
      const image = readRepaintable(document, stream);
      return typeof image === 'string' ? image : null;
    },
  );
  analysis.edits.push(...graphics.edits);
  analysis.repaints = graphics.repaints;
  analysis.affected = graphics.affected;
  for (const reason of graphics.raster) raster.add(reason);

  analysis.raster = [...raster];
  return analysis;
}

/** What happens to one run: untouched, a rewrite, or a reason it cannot be cut. */
function cutText(
  run: TextRun,
  operations: readonly ContentOperation[],
  marks: readonly Rect[],
  removed: RemovedGlyph[],
): ContentEdit | 'untouched' | 'unmeasured' | 'uncut' {
  if (!runMeasurable(run)) return unmeasurableRunTouches(run, marks) ? 'unmeasured' : 'untouched';

  const boxes = glyphBoxes(run);
  const covered = boxes.map((box) => glyphCovered(box, marks));
  if (!covered.includes(true)) return 'untouched';

  const operation = operations[run.operationIndex];
  const edit = operation === undefined ? null : cutRun(run, operation, covered);
  if (edit === null) return 'uncut';

  covered.forEach((isCovered, index) => {
    const box = boxes[index];
    if (isCovered && box !== undefined) {
      removed.push({
        text: run.glyphs[index]?.text ?? '',
        box,
        operationIndex: run.operationIndex,
      });
    }
  });
  return edit;
}

/**
 * Takes the replacement text out of marked content around text that was cut.
 *
 * `/Span << /ActualText (…) >> BDC` tells a reader what the glyphs inside
 * say; left alone, it would go on saying it after the glyphs are gone.
 */
function describedText(
  operations: readonly ContentOperation[],
  cut: ReadonlySet<number>,
): ContentEdit[] {
  const edits: ContentEdit[] = [];
  const open: Array<{ index: number; dict: Map<string, ContentValue> | null }> = [];

  operations.forEach((operation, index) => {
    if (operation.operator === 'BMC') open.push({ index, dict: null });
    if (operation.operator === 'BDC') {
      const properties = operation.operands[1];
      open.push({ index, dict: properties?.kind === 'dict' ? properties.entries : null });
    }
    if (operation.operator !== 'EMC') return;

    const block = open.pop();
    const dict = block?.dict ?? null;
    if (block === undefined || dict === null) return;
    if (!TEXT_KEYS.some((key) => dict.has(key))) return;
    if (![...cut].some((cutIndex) => cutIndex > block.index && cutIndex < index)) return;

    const range = operations[block.index]?.operandRanges[1];
    if (range === undefined) return;
    const kept = new Map(
      [...dict].filter(([key]) => !(TEXT_KEYS as readonly string[]).includes(key)),
    );
    edits.push({ range, replacement: formatValue({ kind: 'dict', entries: kept }) });
  });
  return edits;
}

/** True when every stream of the page's content can be decoded. */
function contentReadable(document: PDFDocument, page: PDFPage): boolean {
  const contents = document.context.lookup(page.node.get(PDFName.of('Contents')));
  const streams: Array<PDFObject | undefined> =
    contents instanceof PDFArray
      ? contents.asArray().map((value) => document.context.lookup(value))
      : contents === undefined
        ? []
        : [contents];

  return streams.every((stream) => {
    if (!(stream instanceof PDFStream)) return false;
    if (!(stream instanceof PDFRawStream)) return true;
    try {
      decodePDFRawStream(stream).decode();
      return true;
    } catch {
      return false;
    }
  });
}

/** The page's pictures and groups, by resource name. */
export function xobjectsOf(
  document: PDFDocument,
  page: PDFPage,
): Map<string, { info: XObjectInfo; stream: PDFStream; ref: PDFRef | null }> {
  const found = new Map<string, { info: XObjectInfo; stream: PDFStream; ref: PDFRef | null }>();
  const dict = document.context.lookupMaybe(
    resourcesOf(document, page)?.get(PDFName.of('XObject')),
    PDFDict,
  );
  for (const [key, value] of dict?.entries() ?? []) {
    const stream = document.context.lookup(value);
    if (!(stream instanceof PDFStream)) continue;
    const subtype = stream.dict.lookup(PDFName.of('Subtype'));
    const kind =
      subtype instanceof PDFName && subtype.decodeText() === 'Image'
        ? 'image'
        : subtype instanceof PDFName && subtype.decodeText() === 'Form'
          ? 'form'
          : 'other';
    found.set(key.decodeText(), {
      info: {
        kind,
        bbox: kind === 'form' ? rectFrom(stream.dict.lookup(PDFName.of('BBox'))) : null,
        matrix: kind === 'form' ? matrixFrom(stream.dict.lookup(PDFName.of('Matrix'))) : null,
      },
      stream,
      ref: value instanceof PDFRef ? value : null,
    });
  }
  return found;
}

function numbers(value: PDFObject | undefined, count: number): number[] | null {
  if (!(value instanceof PDFArray) || value.size() < count) return null;
  const result = value
    .asArray()
    .slice(0, count)
    .map((item) => (item instanceof PDFNumber ? item.asNumber() : Number.NaN));
  return result.every(Number.isFinite) ? result : null;
}

function rectFrom(value: PDFObject | undefined): Rect | null {
  const values = numbers(value, 4);
  if (values === null) return null;
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = values;
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}

function matrixFrom(value: PDFObject | undefined): Matrix | null {
  const values = numbers(value, 6);
  if (values === null) return null;
  const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = values;
  return { a, b, c, d, e, f };
}
