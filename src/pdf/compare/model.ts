import type { TextChange, Word, WordBox } from './textDiff';

/**
 * What a comparison found, in terms a reader can act on.
 *
 * Pages are paired by position, with an offset the reader can set when a page
 * was inserted near the front. Each pair yields text changes, picture and
 * layout changes the text does not explain, and changes of page size; a page
 * with no partner is a difference of its own.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PagePair {
  /** Position in the comparison, from 1. */
  index: number;
  original: number | null;
  revised: number | null;
}

export type DifferenceKind =
  'textAdded' | 'textRemoved' | 'textChanged' | 'visual' | 'pageAdded' | 'pageRemoved' | 'pageSize';

export interface Difference {
  id: string;
  /** The pair it belongs to. */
  pair: number;
  kind: DifferenceKind;
  /** One line for the list. */
  summary: string;
  /** Where it is on each page, in that page's PDF user space. */
  originalRects: Rect[];
  revisedRects: Rect[];
}

/** Which kinds each filter in the panel shows. */
export const DIFFERENCE_GROUPS: Record<'text' | 'visual', readonly DifferenceKind[]> = {
  text: ['textAdded', 'textRemoved', 'textChanged'],
  visual: ['visual', 'pageAdded', 'pageRemoved', 'pageSize'],
};

/** Pairs every page of both documents; `offset` is how far the revision runs ahead. */
export function pairPages(originalCount: number, revisedCount: number, offset: number): PagePair[] {
  const pairs: PagePair[] = [];
  const first = Math.min(1, 1 - offset);
  const last = Math.max(originalCount, revisedCount - offset);
  for (let page = first; page <= last; page += 1) {
    const revised = page + offset;
    pairs.push({
      index: pairs.length + 1,
      original: page >= 1 && page <= originalCount ? page : null,
      revised: revised >= 1 && revised <= revisedCount ? revised : null,
    });
  }
  return pairs;
}

const SUMMARY_LENGTH = 70;

export function textDifferences(pair: number, changes: readonly TextChange[]): Difference[] {
  return changes.map((change, index) => {
    const before = quote(change.before);
    const after = quote(change.after);
    const summary =
      change.kind === 'added'
        ? `Added ${after}`
        : change.kind === 'removed'
          ? `Removed ${before}`
          : `${before} → ${after}`;
    return {
      id: `p${String(pair)}-t${String(index)}`,
      pair,
      kind:
        change.kind === 'added'
          ? 'textAdded'
          : change.kind === 'removed'
            ? 'textRemoved'
            : 'textChanged',
      summary,
      originalRects: lineRects(change.before),
      revisedRects: lineRects(change.after),
    };
  });
}

/**
 * Picture and layout differences: the regions where the pages' pixels differ
 * and no text change accounts for it. A changed word redraws its own pixels,
 * and listing it twice would only be noise.
 */
export function visualDifferences(
  pair: number,
  regions: ReadonlyArray<{ original: Rect | null; revised: Rect | null }>,
  explained: { original: readonly Rect[]; revised: readonly Rect[] },
): Difference[] {
  const differences: Difference[] = [];
  regions.forEach((region, index) => {
    const coveredOriginal =
      region.original !== null &&
      explained.original.some((rect) => overlaps(rect, region.original as Rect));
    const coveredRevised =
      region.revised !== null &&
      explained.revised.some((rect) => overlaps(rect, region.revised as Rect));
    if (coveredOriginal || coveredRevised) return;
    differences.push({
      id: `p${String(pair)}-v${String(index)}`,
      pair,
      kind: 'visual',
      summary: 'Picture, drawing or layout changed',
      originalRects: region.original === null ? [] : [region.original],
      revisedRects: region.revised === null ? [] : [region.revised],
    });
  });
  return differences;
}

export function pageDifference(pair: PagePair): Difference | null {
  if (pair.original !== null && pair.revised !== null) return null;
  const onlyRevised = pair.original === null;
  return {
    id: `p${String(pair.index)}-page`,
    pair: pair.index,
    kind: onlyRevised ? 'pageAdded' : 'pageRemoved',
    summary: onlyRevised
      ? `Page ${String(pair.revised)} is only in the revised document`
      : `Page ${String(pair.original)} is only in the original document`,
    originalRects: [],
    revisedRects: [],
  };
}

export function sizeDifference(
  pair: number,
  original: { width: number; height: number },
  revised: { width: number; height: number },
): Difference | null {
  if (
    Math.abs(original.width - revised.width) < 1 &&
    Math.abs(original.height - revised.height) < 1
  ) {
    return null;
  }
  const size = (box: { width: number; height: number }): string =>
    `${String(Math.round(box.width))} × ${String(Math.round(box.height))}`;
  return {
    id: `p${String(pair)}-size`,
    pair,
    kind: 'pageSize',
    summary: `Page size changed: ${size(original)} → ${size(revised)} pt`,
    originalRects: [],
    revisedRects: [],
  };
}

/** The boxes of a run of words, one per line they sit on. */
export function lineRects(words: readonly Word[]): Rect[] {
  const lines: WordBox[] = [];
  for (const { box } of words) {
    const line = lines[lines.length - 1];
    const sameLine =
      line !== undefined &&
      Math.abs(line.y - box.y) < Math.max(line.height, box.height) / 2 &&
      box.x >= line.x - 1;
    if (line !== undefined && sameLine) {
      const right = Math.max(line.x + line.width, box.x + box.width);
      const top = Math.max(line.y + line.height, box.y + box.height);
      line.x = Math.min(line.x, box.x);
      line.y = Math.min(line.y, box.y);
      line.width = right - line.x;
      line.height = top - line.y;
    } else {
      lines.push({ ...box });
    }
  }
  return lines;
}

function quote(words: readonly Word[]): string {
  const text = words.map((word) => word.text).join(' ');
  return `“${text.length > SUMMARY_LENGTH ? `${text.slice(0, SUMMARY_LENGTH - 1)}…` : text}”`;
}

function overlaps(first: Rect, second: Rect): boolean {
  return (
    first.x < second.x + second.width &&
    second.x < first.x + first.width &&
    first.y < second.y + second.height &&
    second.y < first.y + first.height
  );
}
