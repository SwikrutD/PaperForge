import { describe, expect, it } from 'vitest';
import type { PdfPageGeometry } from '../../../src/pdf/render/types';
import {
  cssBoxStyle,
  cssPointToPdf,
  cssRectToPdf,
  pdfRectToCss,
  quarterTurns,
  rectFromCorners,
} from '../../../src/renderer/components/viewer/pageGeometry';

/**
 * Letter-size page. `width`/`height` are the displayed size, so a page with a
 * baked-in quarter turn reports the swapped size — the same convention the
 * render engine produces.
 */
function page(
  rotation = 0,
  viewBox: [number, number, number, number] = [0, 0, 612, 792],
): PdfPageGeometry {
  const boxWidth = viewBox[2] - viewBox[0];
  const boxHeight = viewBox[3] - viewBox[1];
  const swapped = quarterTurns(rotation) % 2 === 1;
  return {
    pageNumber: 1,
    width: swapped ? boxHeight : boxWidth,
    height: swapped ? boxWidth : boxHeight,
    rotation,
    label: null,
    viewBox,
    userUnit: 1,
  };
}

/** A 10 × 12 box sitting on the bottom-left corner of the page. */
const CORNER = { x: 0, y: 0, width: 10, height: 12 };

describe('quarterTurns', () => {
  it('normalizes any multiple of ninety degrees', () => {
    expect(quarterTurns(0)).toBe(0);
    expect(quarterTurns(90)).toBe(1);
    expect(quarterTurns(360)).toBe(0);
    expect(quarterTurns(450)).toBe(1);
    expect(quarterTurns(-90)).toBe(3);
  });
});

describe('rectFromCorners', () => {
  it('accepts the corners in any order', () => {
    expect(rectFromCorners([10, 20, 40, 60])).toEqual({ x: 10, y: 20, width: 30, height: 40 });
    expect(rectFromCorners([40, 60, 10, 20])).toEqual({ x: 10, y: 20, width: 30, height: 40 });
  });
});

describe('pdfRectToCss', () => {
  it('flips the y axis on an upright page', () => {
    expect(pdfRectToCss(CORNER, page(), 1, 0)).toEqual({
      left: 0,
      top: 780,
      width: 10,
      height: 12,
    });
  });

  it('scales the box with the zoom', () => {
    expect(pdfRectToCss(CORNER, page(), 2, 0)).toEqual({
      left: 0,
      top: 1560,
      width: 20,
      height: 24,
    });
  });

  // A quarter turn clockwise takes the bottom-left corner to the top left, and
  // swaps the box's own width and height with it.
  it('follows a quarter turn of the view', () => {
    expect(pdfRectToCss(CORNER, page(), 1, 90)).toEqual({
      left: 0,
      top: 0,
      width: 12,
      height: 10,
    });
  });

  it('follows a half turn of the view', () => {
    expect(pdfRectToCss(CORNER, page(), 1, 180)).toEqual({
      left: 602,
      top: 0,
      width: 10,
      height: 12,
    });
  });

  it('follows three quarter turns of the view', () => {
    expect(pdfRectToCss(CORNER, page(), 1, 270)).toEqual({
      left: 780,
      top: 602,
      width: 12,
      height: 10,
    });
  });

  // Regression: rotation baked into the page counted the same as the view's.
  it('counts the rotation baked into the page', () => {
    const rotated = page(90);
    expect(rotated.width).toBe(792);
    expect(pdfRectToCss(CORNER, rotated, 1, 0)).toEqual({
      left: 0,
      top: 0,
      width: 12,
      height: 10,
    });
    // Page and view rotation add up to a half turn.
    expect(pdfRectToCss(CORNER, rotated, 1, 90)).toEqual({
      left: 602,
      top: 0,
      width: 10,
      height: 12,
    });
  });

  it('works from a view box that does not start at zero', () => {
    const offset = page(0, [20, 30, 632, 822]);
    const rect = { x: 20, y: 30, width: 10, height: 12 };
    expect(pdfRectToCss(rect, offset, 1, 0)).toEqual({ left: 0, top: 780, width: 10, height: 12 });
  });

  it('applies the document user unit', () => {
    const scaled: PdfPageGeometry = { ...page(), userUnit: 2 };
    expect(pdfRectToCss(CORNER, scaled, 1, 0)).toEqual({
      left: 0,
      top: 1560,
      width: 20,
      height: 24,
    });
  });

  it('has nothing to draw for an empty rectangle', () => {
    expect(pdfRectToCss({ x: 10, y: 10, width: 0, height: 5 }, page(), 1, 0)).toBeNull();
    expect(pdfRectToCss({ x: 10, y: 10, width: 5, height: -1 }, page(), 1, 0)).toBeNull();
  });

  it('writes the box out as CSS pixels', () => {
    expect(cssBoxStyle({ left: 1.5, top: 2, width: 3, height: 4 })).toEqual({
      left: '1.5px',
      top: '2px',
      width: '3px',
      height: '4px',
    });
  });
});

describe('cssPointToPdf', () => {
  // The inverse has to be exact, or a drawn annotation would drift a little
  // every time it was read back and redrawn.
  it('undoes pdfRectToCss for every rotation', () => {
    const rect = { x: 120, y: 300, width: 40, height: 20 };
    for (const pageRotation of [0, 90, 180, 270]) {
      for (const viewRotation of [0, 90, 180, 270]) {
        const geometry = page(pageRotation);
        const box = pdfRectToCss(rect, geometry, 1.5, viewRotation);
        expect(box).not.toBeNull();

        const back = cssRectToPdf(box!, geometry, 1.5, viewRotation);
        expect(back.x).toBeCloseTo(rect.x, 4);
        expect(back.y).toBeCloseTo(rect.y, 4);
        expect(back.width).toBeCloseTo(rect.width, 4);
        expect(back.height).toBeCloseTo(rect.height, 4);
      }
    }
  });

  it('works from a view box that does not start at zero', () => {
    const geometry = page(0, [20, 30, 632, 822]);
    const point = cssPointToPdf({ x: 0, y: 0 }, geometry, 1, 0);
    expect(point).toEqual({ x: 20, y: 822 });
  });
});
