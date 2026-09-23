import { describe, expect, it } from 'vitest';
import {
  EMPTY_SELECTION,
  allPages,
  isNoopMove,
  moveSelection,
  orderAfterMove,
  partsAtBoundaries,
  partsEveryN,
  selectAll,
  selectPage,
  selectionAfterRemoval,
  defaultCropBox,
} from '../../../src/renderer/components/organize/organizeSelection';

describe('choosing pages', () => {
  it('replaces the selection on a plain click', () => {
    const first = selectPage(EMPTY_SELECTION, 3, 'replace');
    expect(first).toEqual({ pages: [3], anchor: 3 });
    expect(selectPage(first, 7, 'replace')).toEqual({ pages: [7], anchor: 7 });
  });

  it('adds and removes pages on a toggle', () => {
    const two = selectPage(selectPage(EMPTY_SELECTION, 5, 'replace'), 2, 'toggle');
    expect(two.pages).toEqual([2, 5]);
    expect(selectPage(two, 5, 'toggle').pages).toEqual([2]);
  });

  it('keeps the anchor so a range can be grown twice', () => {
    const anchored = selectPage(EMPTY_SELECTION, 4, 'replace');
    const first = selectPage(anchored, 6, 'range');
    expect(first.pages).toEqual([4, 5, 6]);

    const narrowed = selectPage(first, 5, 'range');
    expect(narrowed.pages).toEqual([4, 5]);
    expect(narrowed.anchor).toBe(4);
  });

  it('reads a backwards range as a range', () => {
    const anchored = selectPage(EMPTY_SELECTION, 6, 'replace');
    expect(selectPage(anchored, 3, 'range').pages).toEqual([3, 4, 5, 6]);
  });

  it('chooses everything, and nothing in an empty document', () => {
    expect(selectAll(3)).toEqual({ pages: [1, 2, 3], anchor: 1 });
    expect(selectAll(0)).toEqual({ pages: [], anchor: null });
  });

  it('moves and extends with the arrow keys, stopping at the ends', () => {
    const start = selectPage(EMPTY_SELECTION, 1, 'replace');
    expect(moveSelection(start, 1, 5, false).pages).toEqual([2]);
    expect(moveSelection(start, -1, 5, false).pages).toEqual([1]);
    expect(moveSelection(start, 3, 5, true).pages).toEqual([1, 2, 3, 4]);
    expect(moveSelection(start, 99, 5, false).pages).toEqual([5]);
  });

  it('lands on the page that took the place of the first one deleted', () => {
    expect(selectionAfterRemoval([2, 3], 6)).toEqual({ pages: [2], anchor: 2 });
    // Deleting the last pages leaves the selection on the new last page.
    expect(selectionAfterRemoval([5, 6], 6)).toEqual({ pages: [4], anchor: 4 });
    expect(selectionAfterRemoval([1, 2, 3], 3)).toEqual(EMPTY_SELECTION);
  });
});

describe('where a drop lands', () => {
  const order = allPages(5);

  it('counts the target in the document before the move', () => {
    // Page 1 dropped between 3 and 4: the gap is index 3 before the move.
    expect(orderAfterMove(order, [1], 3)).toEqual([2, 3, 1, 4, 5]);
    // Page 5 dropped at the very front.
    expect(orderAfterMove(order, [5], 0)).toEqual([5, 1, 2, 3, 4]);
  });

  it('keeps moved pages in their own order', () => {
    expect(orderAfterMove(order, [4, 2], 0)).toEqual([2, 4, 1, 3, 5]);
  });

  it('recognizes a drop that changes nothing', () => {
    expect(isNoopMove(order, [3], 2)).toBe(true);
    expect(isNoopMove(order, [3], 3)).toBe(true);
    expect(isNoopMove(order, [3], 4)).toBe(false);
    expect(isNoopMove(order, [1, 2], 0)).toBe(true);
  });
});

describe('splitting', () => {
  it('cuts every N pages, with a short last piece', () => {
    expect(partsEveryN(5, 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(partsEveryN(3, 1)).toEqual([[1], [2], [3]]);
    // A nonsensical size still produces whole pages rather than nothing.
    expect(partsEveryN(2, 0)).toEqual([[1], [2]]);
  });

  it('cuts at the pages bookmarks start on', () => {
    expect(partsAtBoundaries(6, [1, 4])).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
  });

  it('keeps the pages before the first bookmark as their own piece', () => {
    expect(partsAtBoundaries(5, [3])).toEqual([
      [1, 2],
      [3, 4, 5],
    ]);
  });

  it('ignores bookmarks outside the document', () => {
    expect(partsAtBoundaries(3, [0, 9])).toEqual([[1, 2, 3]]);
  });
});

describe('the crop rectangle a dialog starts from', () => {
  it('prefers what the page shows over the whole page', () => {
    const boxes = {
      pageNumber: 1,
      rotation: 0,
      media: { x: 0, y: 0, width: 612, height: 792 },
      crop: { x: 10, y: 20, width: 500, height: 700 },
      bleed: null,
      trim: null,
      art: null,
      label: null,
    };
    expect(defaultCropBox(boxes)).toEqual(boxes.crop);
    expect(defaultCropBox({ ...boxes, crop: null })).toEqual(boxes.media);
  });

  it('falls back to a letter page when the boxes have not been read', () => {
    expect(defaultCropBox(undefined)).toEqual({ x: 0, y: 0, width: 612, height: 792 });
  });
});
