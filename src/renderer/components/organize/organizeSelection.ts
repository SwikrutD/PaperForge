import type { PageBoxes } from '@shared/schemas/pages';

/**
 * Choosing pages, and the arithmetic the page grid needs.
 *
 * All of it is pure, so the fiddly parts — what a shift-click means, where a
 * drop lands, what to select after pages are deleted — can be tested on their
 * own.
 */

export type SelectionModifier = 'replace' | 'toggle' | 'range';

export interface SelectionState {
  /** Pages chosen, as page numbers. */
  pages: number[];
  /** Where a range selection counts from. */
  anchor: number | null;
}

export const EMPTY_SELECTION: SelectionState = { pages: [], anchor: null };

function sorted(pages: Iterable<number>): number[] {
  return [...new Set(pages)].sort((a, b) => a - b);
}

/** Applies a click on a page, with whatever modifier was held. */
export function selectPage(
  current: SelectionState,
  pageNumber: number,
  modifier: SelectionModifier,
): SelectionState {
  if (modifier === 'toggle') {
    const chosen = new Set(current.pages);
    if (chosen.has(pageNumber)) chosen.delete(pageNumber);
    else chosen.add(pageNumber);
    return { pages: sorted(chosen), anchor: pageNumber };
  }

  if (modifier === 'range' && current.anchor !== null) {
    const from = Math.min(current.anchor, pageNumber);
    const to = Math.max(current.anchor, pageNumber);
    const range: number[] = [];
    for (let page = from; page <= to; page += 1) range.push(page);
    // The anchor stays put, so extending the range again grows from the same
    // place rather than from where it last ended.
    return { pages: range, anchor: current.anchor };
  }

  return { pages: [pageNumber], anchor: pageNumber };
}

/** Everything, for Ctrl+A. */
export function selectAll(pageCount: number): SelectionState {
  return {
    pages: Array.from({ length: Math.max(0, pageCount) }, (_, index) => index + 1),
    anchor: pageCount > 0 ? 1 : null,
  };
}

/** Moves the selection one page, the way arrow keys in a grid do. */
export function moveSelection(
  current: SelectionState,
  delta: number,
  pageCount: number,
  extend: boolean,
): SelectionState {
  const from = current.anchor ?? current.pages[current.pages.length - 1] ?? 1;
  const target = Math.min(Math.max(1, from + delta), Math.max(1, pageCount));
  return extend ? selectPage(current, target, 'range') : selectPage(current, target, 'replace');
}

/**
 * What stays selected after pages are taken away.
 *
 * The page that took the place of the first one removed is a better landing
 * place than nothing, which is what a reader expects after deleting.
 */
export function selectionAfterRemoval(
  removed: readonly number[],
  pageCountBefore: number,
): SelectionState {
  const gone = new Set(removed);
  const remaining = pageCountBefore - gone.size;
  if (remaining <= 0) return EMPTY_SELECTION;

  const first = Math.min(...removed);
  const landing = Math.min(first, remaining);
  return { pages: [landing], anchor: landing };
}

/** The pages as they will be after a move, for the grid to show at once. */
export function orderAfterMove(
  order: readonly number[],
  moving: readonly number[],
  toIndex: number,
): number[] {
  const moved = new Set(moving);
  const before = order.slice(0, toIndex).filter((page) => moved.has(page)).length;
  const kept = order.filter((page) => !moved.has(page));
  const block = order.filter((page) => moved.has(page));

  const target = Math.max(0, Math.min(toIndex - before, kept.length));
  return [...kept.slice(0, target), ...block, ...kept.slice(target)];
}

/** Whether a drop would leave everything where it already is. */
export function isNoopMove(
  order: readonly number[],
  moving: readonly number[],
  toIndex: number,
): boolean {
  const after = orderAfterMove(order, moving, toIndex);
  return after.every((page, index) => page === order[index]);
}

/** Every page of a document, as a range. */
export function allPages(pageCount: number): number[] {
  return Array.from({ length: Math.max(0, pageCount) }, (_, index) => index + 1);
}

/** Pieces of `count` pages each, for splitting every N pages. */
export function partsEveryN(pageCount: number, size: number): number[][] {
  const step = Math.max(1, Math.trunc(size));
  const parts: number[][] = [];
  for (let start = 1; start <= pageCount; start += step) {
    parts.push(allPages(pageCount).slice(start - 1, start - 1 + step));
  }
  return parts;
}

/** Pieces that begin at each of the given pages, for splitting by bookmark. */
export function partsAtBoundaries(pageCount: number, starts: readonly number[]): number[][] {
  const points = sorted(starts.filter((page) => page >= 1 && page <= pageCount));
  if (points.length === 0 || (points[0] as number) > 1) points.unshift(1);

  return points.map((start, index) => {
    const end = index + 1 < points.length ? (points[index + 1] as number) - 1 : pageCount;
    const pages: number[] = [];
    for (let page = start; page <= end; page += 1) pages.push(page);
    return pages;
  });
}

/** The size a crop rectangle starts at: what the page already shows. */
export function defaultCropBox(boxes: PageBoxes | undefined): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const box = boxes?.crop ?? boxes?.media;
  return box ?? { x: 0, y: 0, width: 612, height: 792 };
}
