import { describe, expect, it } from 'vitest';
import type { PdfPageGeometry } from '../../../src/pdf/render/types';
import {
  clampScale,
  currentPage,
  layoutPages,
  nextZoomStep,
  PAGE_GAP,
  PAGE_MARGIN,
  rotatedSize,
  scaleForMode,
  scrollBehaviorFor,
  scrollTopForPage,
  visiblePages,
} from '../../../src/renderer/components/viewer/viewerLayout';

function page(pageNumber: number, width = 612, height = 792, rotation = 0): PdfPageGeometry {
  return {
    pageNumber,
    width,
    height,
    rotation,
    label: null,
    viewBox: [0, 0, width, height],
    userUnit: 1,
  };
}

const A4_PORTRAIT = page(1, 595, 842);

describe('rotatedSize', () => {
  it('leaves an upright page alone', () => {
    expect(rotatedSize(A4_PORTRAIT, 0)).toEqual({ width: 595, height: 842 });
    expect(rotatedSize(A4_PORTRAIT, 180)).toEqual({ width: 595, height: 842 });
  });

  it('swaps the sides at a quarter turn', () => {
    expect(rotatedSize(A4_PORTRAIT, 90)).toEqual({ width: 842, height: 595 });
    expect(rotatedSize(A4_PORTRAIT, 270)).toEqual({ width: 842, height: 595 });
  });

  // Regression: the page's own rotation is already in `width`/`height`, so
  // counting it again laid a quarter-turned page out on its side.
  it('does not count the rotation baked into the page twice', () => {
    const landscape = page(1, 842, 595, 90);
    expect(rotatedSize(landscape, 0)).toEqual({ width: 842, height: 595 });
    expect(rotatedSize(landscape, 90)).toEqual({ width: 595, height: 842 });
  });
});

describe('layoutPages', () => {
  it('stacks pages with a gap and margins', () => {
    const layout = layoutPages([page(1, 100, 200), page(2, 100, 100)], 1, 0);

    expect(layout.boxes[0]).toEqual({
      pageNumber: 1,
      top: PAGE_MARGIN,
      left: -50,
      width: 100,
      height: 200,
    });
    expect(layout.boxes[1]).toEqual({
      pageNumber: 2,
      top: PAGE_MARGIN + 200 + PAGE_GAP,
      left: -50,
      width: 100,
      height: 100,
    });
    expect(layout.contentHeight).toBe(PAGE_MARGIN + 200 + PAGE_GAP + 100 + PAGE_MARGIN);
  });

  it('keeps each page at its own size in a mixed document', () => {
    const layout = layoutPages([page(1, 612, 792), page(2, 1224, 792)], 1, 0);

    expect(layout.boxes.map((box) => box.width)).toEqual([612, 1224]);
    expect(layout.contentWidth).toBe(1224 + PAGE_MARGIN * 2);
  });

  it('scales every page', () => {
    const layout = layoutPages([page(1, 100, 200)], 2, 0);
    expect(layout.boxes[0]).toMatchObject({ width: 200, height: 400 });
  });

  it('handles a document with no pages', () => {
    expect(layoutPages([], 1, 0)).toEqual({
      boxes: [],
      contentHeight: 0,
      contentWidth: PAGE_MARGIN * 2,
    });
  });
});

describe('visiblePages', () => {
  const layout = layoutPages(
    Array.from({ length: 50 }, (_, index) => page(index + 1, 600, 800)),
    1,
    0,
  );

  it('mounts only what is near the viewport', () => {
    const visible = visiblePages(layout, 0, 900, 900);
    expect(visible[0]).toBe(1);
    expect(visible.length).toBeLessThan(6);
    expect(visible).not.toContain(20);
  });

  it('follows the scroll position', () => {
    const visible = visiblePages(layout, 8000, 900, 0);
    expect(visible).toContain(10);
    expect(visible).not.toContain(1);
  });

  it('never mounts a thousand pages at once', () => {
    const huge = layoutPages(
      Array.from({ length: 1000 }, (_, index) => page(index + 1, 600, 800)),
      1,
      0,
    );
    expect(visiblePages(huge, 400_000, 1000, 1000).length).toBeLessThanOrEqual(6);
  });

  it('returns nothing without a viewport or pages', () => {
    expect(visiblePages(layout, 0, 0)).toEqual([]);
    expect(visiblePages(layoutPages([], 1, 0), 0, 900)).toEqual([]);
  });
});

describe('page tracking', () => {
  const layout = layoutPages(
    Array.from({ length: 5 }, (_, index) => page(index + 1, 600, 800)),
    1,
    0,
  );

  it('reports the page the viewport is showing', () => {
    expect(currentPage(layout, 0, 900)).toBe(1);
    expect(currentPage(layout, 830, 900)).toBe(2);
    expect(currentPage(layout, 3000, 900)).toBe(4);
  });

  it('scrolls a page to the top', () => {
    const top = scrollTopForPage(layout, 3);
    expect(currentPage(layout, top, 900)).toBe(3);
    expect(scrollTopForPage(layout, 999)).toBe(0);
  });
});

describe('zoom', () => {
  const fitOptions = {
    page: A4_PORTRAIT,
    viewportWidth: 1000,
    viewportHeight: 800,
    viewRotation: 0,
  };

  it('fits the width, allowing for margins and the scrollbar', () => {
    const scale = scaleForMode('fitWidth', { ...fitOptions, scrollbarWidth: 12 });
    expect(scale).toBeCloseTo((1000 - PAGE_MARGIN * 2 - 12) / 595, 5);
  });

  it('fits the whole page inside the viewport', () => {
    const scale = scaleForMode('fitPage', fitOptions);
    expect(scale).toBeCloseTo((800 - PAGE_MARGIN * 2) / 842, 5);
    expect(842 * scale).toBeLessThanOrEqual(800);
  });

  it('accounts for rotation when fitting', () => {
    const rotated = scaleForMode('fitWidth', { ...fitOptions, viewRotation: 90 });
    expect(rotated).toBeCloseTo((1000 - PAGE_MARGIN * 2) / 842, 5);
  });

  it('actual size is one to one', () => {
    expect(scaleForMode('actual', fitOptions)).toBe(1);
  });

  it('keeps a custom scale, clamped to what is sensible', () => {
    expect(scaleForMode('custom', fitOptions, 2.5)).toBe(2.5);
    expect(clampScale(0.0001)).toBe(0.1);
    expect(clampScale(1000)).toBe(10);
    expect(clampScale(Number.NaN)).toBe(1);
  });

  it('steps through zoom levels', () => {
    expect(nextZoomStep(1, 1)).toBe(1.25);
    expect(nextZoomStep(1, -1)).toBe(0.75);
    expect(nextZoomStep(8, 1)).toBe(8);
    expect(nextZoomStep(0.25, -1)).toBe(0.25);
  });

  it('glides to a nearby page and goes straight to a distant one', () => {
    expect(scrollBehaviorFor(900, 600, false)).toBe('smooth');
    expect(scrollBehaviorFor(-1200, 600, false)).toBe('smooth');
    expect(scrollBehaviorFor(50_000, 600, false)).toBe('auto');
    expect(scrollBehaviorFor(-50_000, 600, false)).toBe('auto');
  });

  it('never glides when the reader asked for less motion', () => {
    expect(scrollBehaviorFor(100, 600, true)).toBe('auto');
  });
});
