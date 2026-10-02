import { describe, expect, it } from 'vitest';
import type { PageBoxes } from '../../../src/shared/schemas/pages';
import {
  ZERO_MARGINS,
  adjustFrame,
  cropOperations,
  frameOf,
  marginsFit,
  marginsOf,
  visibleBox,
} from '../../../src/shared/utils/cropBoxes';
import { pagesInScope } from '../../../src/renderer/stores/cropStore';

function page(
  pageNumber: number,
  width: number,
  height: number,
  crop?: PageBoxes['crop'],
): PageBoxes {
  return {
    pageNumber,
    rotation: 0,
    media: { x: 0, y: 0, width, height },
    crop: crop ?? null,
    bleed: null,
    trim: null,
    art: null,
    label: null,
  };
}

describe('crop arithmetic', () => {
  it('reads what a page shows as its crop box clipped to its media box', () => {
    expect(visibleBox(page(1, 600, 800))).toEqual({ x: 0, y: 0, width: 600, height: 800 });
    expect(visibleBox(page(1, 600, 800, { x: -10, y: 50, width: 400, height: 900 }))).toEqual({
      x: 0,
      y: 50,
      width: 390,
      height: 750,
    });
    // Wholly outside the page: ignored, as readers ignore it.
    expect(visibleBox(page(1, 600, 800, { x: 700, y: 0, width: 50, height: 50 }))).toEqual({
      x: 0,
      y: 0,
      width: 600,
      height: 800,
    });
  });

  it('turns a frame into margins and back', () => {
    const visible = { x: 0, y: 0, width: 612, height: 792 };
    const frame = { x: 36, y: 72, width: 500, height: 600 };
    const margins = marginsOf(frame, visible);
    expect(margins).toEqual({ left: 36, bottom: 72, right: 76, top: 120 });
    expect(frameOf(visible, margins)).toEqual(frame);
  });

  it('ignores the part of a frame that lies outside the page', () => {
    const margins = marginsOf(
      { x: -20, y: -20, width: 700, height: 900 },
      { x: 0, y: 0, width: 612, height: 792 },
    );
    expect(margins).toEqual(ZERO_MARGINS);
  });

  it('applies the same margins to pages of different sizes', () => {
    const operations = cropOperations(
      [page(1, 612, 792), page(2, 612, 792), page(3, 842, 595)],
      [1, 2, 3],
      { left: 10, bottom: 20, right: 30, top: 40 },
      'crop',
      'crop',
    );
    expect(operations).toEqual([
      {
        kind: 'cropPages',
        pages: [1, 2],
        box: { x: 10, y: 20, width: 572, height: 732 },
        target: 'crop',
      },
      {
        kind: 'cropPages',
        pages: [3],
        box: { x: 10, y: 20, width: 802, height: 535 },
        target: 'crop',
      },
    ]);
  });

  it('measures from the crop already there, so a second crop compounds the first', () => {
    const [operation] = cropOperations(
      [page(1, 600, 800, { x: 100, y: 100, width: 400, height: 600 })],
      [1],
      { left: 10, bottom: 10, right: 10, top: 10 },
      'crop',
      'crop',
    );
    expect(operation?.box).toEqual({ x: 110, y: 110, width: 380, height: 580 });
  });

  it('says when margins would leave nothing of a page', () => {
    const visible = { x: 0, y: 0, width: 200, height: 200 };
    expect(marginsFit(visible, { left: 50, bottom: 50, right: 50, top: 50 })).toBe(true);
    expect(marginsFit(visible, { left: 150, bottom: 0, right: 60, top: 0 })).toBe(false);
  });
});

describe('dragging the crop frame', () => {
  const bounds = { width: 400, height: 500 };
  const box = { left: 50, top: 60, width: 200, height: 100 };

  it('moves the whole frame and stops it at the page edge', () => {
    expect(adjustFrame(box, 'move', 30, -10, bounds)).toEqual({ ...box, left: 80, top: 50 });
    expect(adjustFrame(box, 'move', 1000, 1000, bounds)).toEqual({
      ...box,
      left: 200,
      top: 400,
    });
  });

  it('moves one edge or a corner', () => {
    expect(adjustFrame(box, 'e', 20, 99, bounds)).toEqual({ ...box, width: 220 });
    expect(adjustFrame(box, 'nw', -10, -20, bounds)).toEqual({
      left: 40,
      top: 40,
      width: 210,
      height: 120,
    });
  });

  it('never turns the frame inside out', () => {
    const result = adjustFrame(box, 'w', 500, 0, bounds, 8);
    expect(result.width).toBe(8);
    expect(result.left).toBe(242);
  });
});

describe('which pages a crop applies to', () => {
  it('is the frame’s page, every page, or a range', () => {
    expect(pagesInScope('page', '', 3, 5)).toEqual({ pages: [3] });
    expect(pagesInScope('page', '', null, 5)).toHaveProperty('problem');
    expect(pagesInScope('all', '', 3, 3)).toEqual({ pages: [1, 2, 3] });
    expect(pagesInScope('range', '2-3, 5', 1, 5)).toEqual({ pages: [2, 3, 5] });
    expect(pagesInScope('range', '9', 1, 5)).toHaveProperty('problem');
  });
});
