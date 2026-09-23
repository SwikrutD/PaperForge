import { describe, expect, it } from 'vitest';
import type { AnnotationGeometry } from '../../../src/shared/schemas/annotation';
import {
  boundsOf,
  quadCorners,
  quadFromRect,
  rectContains,
  rectFromDrag,
  rectFromPoints,
  resizeGeometry,
  translateGeometry,
} from '../../../src/pdf/mutate/annotations/geometry';
import { fromPdfDate, toPdfDate } from '../../../src/pdf/mutate/annotations/pdfDate';
import { isDrawable, toWinAnsi, wrapText } from '../../../src/pdf/text/layout';

describe('annotation bounds', () => {
  it('covers every quad of marked text', () => {
    const geometry: AnnotationGeometry = {
      kind: 'highlight',
      quads: [
        [10, 100, 60, 100, 10, 88, 60, 88],
        [10, 86, 90, 86, 10, 74, 90, 74],
      ],
    };

    const bounds = boundsOf(geometry);
    expect(bounds.x).toBeCloseTo(9, 5);
    expect(bounds.y).toBeCloseTo(73, 5);
    expect(bounds.width).toBeCloseTo(82, 5);
    expect(bounds.height).toBeCloseTo(28, 5);
  });

  it('hangs a sticky note below the point it was placed at', () => {
    const bounds = boundsOf({ kind: 'note', point: { x: 50, y: 700 } });
    expect(bounds).toEqual({ x: 50, y: 680, width: 20, height: 20 });
  });

  // The rectangle has to be wide enough for the stroke, which is centred on
  // the shape's edge.
  it('leaves room for a thick stroke around a shape', () => {
    const rect = { x: 100, y: 100, width: 50, height: 40 };
    const thin = boundsOf({ kind: 'square', rect }, 1);
    const thick = boundsOf({ kind: 'square', rect }, 10);

    expect(thin.width).toBeGreaterThan(rect.width);
    expect(thick.width).toBeGreaterThan(thin.width);
    expect(thick.x).toBeLessThan(rect.x);
  });

  it('covers the line of a callout as well as its box', () => {
    const bounds = boundsOf({
      kind: 'callout',
      rect: { x: 300, y: 500, width: 100, height: 40 },
      callout: [
        { x: 120, y: 420 },
        { x: 220, y: 480 },
      ],
    });

    expect(bounds.x).toBeLessThan(120);
    expect(bounds.y).toBeLessThan(420);
    expect(bounds.x + bounds.width).toBeGreaterThan(400);
  });

  it('covers every stroke of a drawing', () => {
    const bounds = boundsOf({
      kind: 'ink',
      strokes: [
        [
          { x: 10, y: 10 },
          { x: 40, y: 50 },
        ],
        [{ x: 200, y: 5 }],
      ],
    });
    expect(bounds.x).toBeLessThan(10);
    expect(bounds.x + bounds.width).toBeGreaterThan(200);
  });
});

describe('moving and resizing', () => {
  it('moves every kind by the same amount', () => {
    const geometries: AnnotationGeometry[] = [
      { kind: 'highlight', quads: [[0, 10, 10, 10, 0, 0, 10, 0]] },
      { kind: 'note', point: { x: 5, y: 5 } },
      { kind: 'square', rect: { x: 5, y: 5, width: 10, height: 10 } },
      { kind: 'line', from: { x: 0, y: 0 }, to: { x: 10, y: 10 } },
      {
        kind: 'polyline',
        vertices: [
          { x: 0, y: 0 },
          { x: 4, y: 4 },
        ],
      },
      { kind: 'ink', strokes: [[{ x: 1, y: 1 }]] },
    ];

    for (const geometry of geometries) {
      const before = boundsOf(geometry);
      const after = boundsOf(translateGeometry(geometry, 30, -20));
      expect(after.x).toBeCloseTo(before.x + 30, 5);
      expect(after.y).toBeCloseTo(before.y - 20, 5);
      expect(after.width).toBeCloseTo(before.width, 5);
    }
  });

  it('resizes what has a rectangle and refuses what does not', () => {
    const rect = { x: 0, y: 0, width: 20, height: 10 };
    expect(
      resizeGeometry({ kind: 'square', rect: { x: 5, y: 5, width: 1, height: 1 } }, rect),
    ).toEqual({ kind: 'square', rect });
    // Marked text belongs to the words it marks, and ink to the hand that drew
    // it: neither is stretched.
    expect(
      resizeGeometry({ kind: 'highlight', quads: [[0, 1, 1, 1, 0, 0, 1, 0]] }, rect),
    ).toBeNull();
    expect(resizeGeometry({ kind: 'ink', strokes: [[{ x: 0, y: 0 }]] }, rect)).toBeNull();
  });
});

describe('quads and rectangles', () => {
  it('writes a quad in the order PDF states the corners', () => {
    const quad = quadFromRect({ x: 10, y: 20, width: 30, height: 12 });
    const corners = quadCorners(quad);

    expect(corners.upperLeft).toEqual({ x: 10, y: 32 });
    expect(corners.upperRight).toEqual({ x: 40, y: 32 });
    expect(corners.lowerLeft).toEqual({ x: 10, y: 20 });
    expect(corners.lowerRight).toEqual({ x: 40, y: 20 });
  });

  it('reads a drag in any direction as the same rectangle', () => {
    const expected = { x: 10, y: 20, width: 30, height: 40 };
    expect(rectFromDrag({ x: 10, y: 20 }, { x: 40, y: 60 })).toEqual(expected);
    expect(rectFromDrag({ x: 40, y: 60 }, { x: 10, y: 20 })).toEqual(expected);
  });

  it('knows what a rectangle contains', () => {
    const rect = { x: 0, y: 0, width: 10, height: 10 };
    expect(rectContains(rect, { x: 5, y: 5 })).toBe(true);
    expect(rectContains(rect, { x: 11, y: 5 })).toBe(false);
  });

  it('has an empty rectangle for no points at all', () => {
    expect(rectFromPoints([])).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});

describe('PDF dates', () => {
  it('writes and reads back the same moment', () => {
    const date = new Date('2026-09-22T14:05:09.000Z');
    const written = toPdfDate(date);

    expect(written).toMatch(/^D:\d{14}/);
    expect(fromPdfDate(written)).toBe(date.toISOString());
  });

  it('reads the sloppy dates other producers write', () => {
    expect(fromPdfDate('D:20240102')).toBe('2024-01-02T00:00:00.000Z');
    expect(fromPdfDate("D:20240102030405+02'00'")).toBe('2024-01-02T01:04:05.000Z');
    expect(fromPdfDate('20240102030405Z')).toBe('2024-01-02T03:04:05.000Z');
  });

  it('reports a date it cannot read as unknown', () => {
    expect(fromPdfDate('yesterday')).toBeNull();
    expect(fromPdfDate(undefined)).toBeNull();
    expect(fromPdfDate('')).toBeNull();
  });
});

describe('appearance text', () => {
  it('keeps what Helvetica can draw', () => {
    expect(toWinAnsi('Plain ASCII, and café')).toBe('Plain ASCII, and café');
    expect(isDrawable('Plain ASCII')).toBe(true);
  });

  it('replaces what it cannot, rather than failing the save', () => {
    expect(toWinAnsi('早上好')).toBe('???');
    expect(toWinAnsi('“quoted” — dash…')).toBe('"quoted" - dash...');
    expect(isDrawable('早上好')).toBe(false);
  });

  // A fixed-width font, so the arithmetic in the test is obvious.
  const font = {
    widthOfTextAtSize: (text: string, size: number) => text.length * size * 0.5,
  } as never;

  it('wraps text to the width of the box', () => {
    const lines = wrapText('one two three four five six', font, 10, 60);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(line.length * 5).toBeLessThanOrEqual(60);
  });

  it('keeps the line breaks the author typed', () => {
    expect(wrapText('first\nsecond', font, 10, 400)).toEqual(['first', 'second']);
  });

  it('breaks a word that is too long to fit on its own', () => {
    const lines = wrapText('supercalifragilistic', font, 10, 30);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join('')).toBe('supercalifragilistic');
  });
});
