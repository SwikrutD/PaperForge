import { PDFArray, PDFDict, PDFName, PDFNumber, PDFStream, type PDFDocument } from 'pdf-lib';
import type { AccessibilityRect, ReadingOrderRegion } from '@shared/schemas/accessibility';
import { resourcesOf } from '../content/pageContent';
import { applyMatrix, multiply, walkContent, IDENTITY, type Matrix } from '../content/state';
import { runBounds } from '../content/textRuns';
import { numberOf } from '../content/values';
import { readPageWithImages } from '../mutate/images';
import { boundsOfPoints, transformRect, union, type Rect } from '../redact/geometry';
import { markedStates } from './markedContent';
import type { StructureTree } from './structure';

/**
 * Where a tagged page's content is, by the tag tree element that owns it.
 *
 * The geometry comes from the page's own drawing — the boxes of the text it
 * shows, the pictures it paints, the paths it fills — grouped by the marked
 * content identifier each is drawn under. Nothing is guessed: content the page
 * draws outside any bracket is reported as untagged, and an element whose
 * content cannot be found on the page simply has no region.
 */

const PATH_OPERATORS = new Set(['m', 'l', 'c', 'v', 'y', 're']);
const MAX_REGIONS = 5000;

export interface PageMarkedGeometry {
  /** The box of everything drawn under each identifier. */
  byMcid: Map<number, Rect>;
  /** Text drawn outside any identifier and not marked as decoration. */
  untagged: Rect[];
}

export async function pageMarkedGeometry(
  document: PDFDocument,
  pageIndex: number,
): Promise<PageMarkedGeometry> {
  const content = await readPageWithImages(document, pageIndex);
  const page = document.getPage(pageIndex);
  const resources = resourcesOf(document, page);
  const states = markedStates(content.operations, propertyMcids(document, resources));

  const byMcid = new Map<number, Rect>();
  const add = (mcid: number | null, rect: Rect): void => {
    if (mcid === null || !(rect.width > 0 || rect.height > 0)) return;
    const existing = byMcid.get(mcid);
    byMcid.set(mcid, existing === undefined ? rect : union(existing, rect));
  };

  const untagged: Rect[] = [];
  for (const run of content.runs) {
    if (run.text.trim() === '') continue;
    const state = states[run.operationIndex];
    const box = runBounds(run);
    if (state?.mcid !== null && state?.mcid !== undefined) add(state.mcid, box);
    else if (state?.artifact !== true) untagged.push(box);
  }

  for (const image of content.images) {
    if (!image.facts.isImage) continue;
    add(states[image.operationIndex]?.mcid ?? null, image.bounds);
  }

  // Paths and groups, which the image and text models leave out.
  const xobjects = document.context.lookupMaybe(resources?.get(PDFName.of('XObject')), PDFDict);
  let points: { x: number; y: number }[] = [];
  walkContent(content.operations, {
    onOperation: ({ operation, index, state }) => {
      const mcid = states[index]?.mcid ?? null;
      if (PATH_OPERATORS.has(operation.operator)) {
        points.push(...pathPoints(operation.operator, operation.operands, state.ctm));
        return;
      }
      if (isPaint(operation.operator)) {
        if (points.length > 0 && operation.operator !== 'n') add(mcid, boundsOfPoints(points));
        points = [];
        return;
      }
      if (operation.operator === 'Do' && xobjects !== undefined) {
        const name = operation.operands[0];
        if (name?.kind !== 'name') return;
        const box = formBounds(document, xobjects, name.value, state.ctm);
        if (box !== null) add(mcid, box);
      }
    },
  });

  return { byMcid, untagged: untagged.slice(0, MAX_REGIONS) };
}

/**
 * The page's content in the order the tag tree reads it: one numbered region
 * per element that owns content on this page.
 */
export async function readingOrderOf(
  document: PDFDocument,
  tree: StructureTree,
  pageIndex: number,
): Promise<{ regions: ReadingOrderRegion[]; untagged: AccessibilityRect[] }> {
  const geometry = await pageMarkedGeometry(document, pageIndex);
  const annotationRects = annotationRectsOf(document, pageIndex);
  const regions: ReadingOrderRegion[] = [];

  for (const element of tree.elements) {
    let box: Rect | null = null;
    for (const item of element.content) {
      const onPage = (item.pageIndex ?? element.pageIndex) === pageIndex;
      if (!onPage) continue;
      const rect =
        item.kind === 'mcid'
          ? geometry.byMcid.get(item.mcid)
          : annotationRects.get(item.ref.toString());
      if (rect !== undefined) box = box === null ? rect : union(box, rect);
    }
    if (box === null) continue;
    regions.push({ order: regions.length + 1, type: element.type, rect: round(box) });
    if (regions.length >= MAX_REGIONS) break;
  }

  return { regions, untagged: geometry.untagged.map(round) };
}

/** Resolves `/Name BDC` property lists to the identifier they carry. */
export function propertyMcids(
  document: PDFDocument,
  resources: PDFDict | undefined,
): (name: string) => number | null {
  const properties = document.context.lookupMaybe(
    resources?.get(PDFName.of('Properties')),
    PDFDict,
  );
  return (name) => {
    const list = document.context.lookupMaybe(properties?.get(PDFName.of(name)), PDFDict);
    const mcid = list?.lookup(PDFName.of('MCID'));
    return mcid instanceof PDFNumber ? mcid.asNumber() : null;
  };
}

function isPaint(operator: string): boolean {
  return ['S', 's', 'f', 'F', 'f*', 'B', 'B*', 'b', 'b*', 'n'].includes(operator);
}

/** The points a path operation adds, in user space. */
function pathPoints(
  operator: string,
  operands: readonly Parameters<typeof numberOf>[0][],
  ctm: Matrix,
): { x: number; y: number }[] {
  const values = operands.map((operand) => numberOf(operand));
  if (operator === 're') {
    const [x = 0, y = 0, width = 0, height = 0] = values;
    return [
      applyMatrix(ctm, x, y),
      applyMatrix(ctm, x + width, y),
      applyMatrix(ctm, x, y + height),
      applyMatrix(ctm, x + width, y + height),
    ];
  }
  const points: { x: number; y: number }[] = [];
  for (let index = 0; index + 1 < values.length; index += 2) {
    points.push(applyMatrix(ctm, values[index] as number, values[index + 1] as number));
  }
  return points;
}

/** Where a form XObject draws, from its bounding box. Pictures are counted elsewhere. */
function formBounds(
  document: PDFDocument,
  xobjects: PDFDict,
  name: string,
  ctm: Matrix,
): Rect | null {
  const stream = document.context.lookup(xobjects.get(PDFName.of(name)));
  if (!(stream instanceof PDFStream)) return null;
  const subtype = stream.dict.lookup(PDFName.of('Subtype'));
  if (!(subtype instanceof PDFName) || subtype.decodeText() !== 'Form') return null;

  const bbox = numbers(stream.dict.lookup(PDFName.of('BBox')));
  if (bbox.length < 4) return null;
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = bbox;
  const matrixValues = numbers(stream.dict.lookup(PDFName.of('Matrix')));
  const own: Matrix =
    matrixValues.length === 6
      ? {
          a: matrixValues[0] as number,
          b: matrixValues[1] as number,
          c: matrixValues[2] as number,
          d: matrixValues[3] as number,
          e: matrixValues[4] as number,
          f: matrixValues[5] as number,
        }
      : IDENTITY;
  return transformRect(multiply(own, ctm), {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  });
}

/** Each annotation's rectangle on a page, by reference, for elements that own one. */
function annotationRectsOf(document: PDFDocument, pageIndex: number): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  const annots = document.getPage(pageIndex).node.Annots();
  if (annots === undefined) return rects;

  for (let index = 0; index < annots.size(); index += 1) {
    const ref = annots.get(index);
    const dict = annots.lookup(index);
    if (!(dict instanceof PDFDict)) continue;
    const values = numbers(dict.lookup(PDFName.of('Rect')));
    if (values.length < 4) continue;
    const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = values;
    rects.set(ref.toString(), {
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      width: Math.abs(x2 - x1),
      height: Math.abs(y2 - y1),
    });
  }
  return rects;
}

function numbers(value: unknown): number[] {
  if (!(value instanceof PDFArray)) return [];
  const found: number[] = [];
  for (let index = 0; index < value.size(); index += 1) {
    const entry = value.get(index);
    if (entry instanceof PDFNumber) found.push(entry.asNumber());
  }
  return found;
}

function round(rect: Rect): AccessibilityRect {
  const fix = (value: number): number => Math.round(value * 100) / 100;
  return {
    x: fix(rect.x),
    y: fix(rect.y),
    width: fix(Math.max(0, rect.width)),
    height: fix(Math.max(0, rect.height)),
  };
}
