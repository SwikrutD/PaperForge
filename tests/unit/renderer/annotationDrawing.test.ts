import { describe, expect, it } from 'vitest';
import type { Annotation } from '../../../src/shared/schemas/annotation';
import { DEFAULT_ANNOTATION_STYLE } from '../../../src/shared/schemas/annotation';
import {
  arrangeComments,
  authorsOf,
  geometryFromDrag,
  geometryFromPath,
  isDragTool,
  isMarkupTool,
  isPathTool,
  quadsFromRects,
  withExtraStroke,
} from '../../../src/renderer/components/annotations/annotationDrawing';
import { DEFAULT_FILTER } from '../../../src/renderer/stores/annotationStore';

function comment(overrides: Partial<Annotation>): Annotation {
  return {
    id: overrides.id ?? 'a',
    pageNumber: 1,
    geometry: { kind: 'square', rect: { x: 0, y: 0, width: 10, height: 10 } },
    style: DEFAULT_ANNOTATION_STYLE,
    contents: '',
    author: 'Ada',
    subject: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    modifiedAt: null,
    resolved: false,
    editable: true,
    ...overrides,
  };
}

describe('tool kinds', () => {
  it('knows which gesture each tool uses', () => {
    expect(isMarkupTool('highlight')).toBe(true);
    expect(isDragTool('square')).toBe(true);
    expect(isPathTool('ink')).toBe(true);
    expect(isDragTool('ink')).toBe(false);
    expect(isMarkupTool('select')).toBe(false);
  });
});

describe('geometryFromDrag', () => {
  const from = { x: 100, y: 500 };

  it('draws a shape between the two corners of a drag', () => {
    const geometry = geometryFromDrag('square', from, { x: 200, y: 560 });
    expect(geometry).toEqual({
      kind: 'square',
      rect: { x: 100, y: 500, width: 100, height: 60 },
    });
  });

  // A shape with no area would be invisible, so a click is not one.
  it('refuses a shape that was never really dragged', () => {
    expect(geometryFromDrag('square', from, { x: 101, y: 501 })).toBeNull();
    expect(geometryFromDrag('line', from, from)).toBeNull();
  });

  it('places a default-sized text box when it is only clicked', () => {
    const geometry = geometryFromDrag('freeText', from, { x: 101, y: 500 });
    expect(geometry).toMatchObject({ kind: 'freeText' });
    if (geometry?.kind !== 'freeText') throw new Error('expected a text box');
    expect(geometry.rect.width).toBeGreaterThan(0);
    // It hangs below the point that was clicked, the way a caret would.
    expect(geometry.rect.y).toBeLessThan(from.y);
  });

  it('points a callout from where it was pressed to a box beside it', () => {
    const geometry = geometryFromDrag('callout', from, from);
    if (geometry?.kind !== 'callout') throw new Error('expected a callout');

    expect(geometry.callout[0]).toEqual(from);
    expect(geometry.callout).toHaveLength(3);
    expect(geometry.rect.x).toBeGreaterThan(from.x);
  });

  it('places an image stamp at the size the image asked for', () => {
    const geometry = geometryFromDrag('imageStamp', from, from, { width: 90, height: 30 });
    if (geometry?.kind !== 'imageStamp') throw new Error('expected an image stamp');
    expect(geometry.rect.width).toBe(90);
    expect(geometry.rect.height).toBe(30);
  });
});

describe('geometryFromPath', () => {
  const points = [
    { x: 0, y: 0 },
    { x: 10, y: 10 },
  ];

  it('makes one stroke of ink from the points the pen passed through', () => {
    expect(geometryFromPath('ink', points)).toEqual({ kind: 'ink', strokes: [points] });
  });

  it('needs two points for a polygon', () => {
    expect(geometryFromPath('polygon', [{ x: 1, y: 1 }])).toBeNull();
    expect(geometryFromPath('polygon', points)).toEqual({ kind: 'polygon', vertices: points });
  });

  it('adds a second stroke to a drawing', () => {
    const first = geometryFromPath('ink', points);
    const both = withExtraStroke(first as never, [{ x: 20, y: 20 }]);
    expect(both).toMatchObject({ kind: 'ink' });
    if (both.kind !== 'ink') throw new Error('expected ink');
    expect(both.strokes).toHaveLength(2);
  });
});

describe('quadsFromRects', () => {
  it('turns each rectangle of selected text into a quad', () => {
    const quads = quadsFromRects([{ x: 10, y: 20, width: 30, height: 12 }]);
    expect(quads).toEqual([[10, 32, 40, 32, 10, 20, 40, 20]]);
  });

  it('drops the empty rectangles a selection collects', () => {
    expect(quadsFromRects([{ x: 0, y: 0, width: 0, height: 12 }])).toEqual([]);
  });
});

describe('arrangeComments', () => {
  const comments = [
    comment({ id: 'c', pageNumber: 3, createdAt: '2026-01-03T00:00:00.000Z' }),
    comment({ id: 'a', pageNumber: 1, createdAt: '2026-01-01T00:00:00.000Z', author: 'Zoe' }),
    comment({
      id: 'b',
      pageNumber: 2,
      createdAt: '2026-01-02T00:00:00.000Z',
      resolved: true,
      geometry: { kind: 'highlight', quads: [[0, 1, 1, 1, 0, 0, 1, 0]] },
    }),
  ];

  it('sorts by page by default', () => {
    expect(arrangeComments(comments, DEFAULT_FILTER, 'page').map((entry) => entry.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('sorts newest first, and by author', () => {
    expect(arrangeComments(comments, DEFAULT_FILTER, 'newest').map((entry) => entry.id)).toEqual([
      'c',
      'b',
      'a',
    ]);
    expect(arrangeComments(comments, DEFAULT_FILTER, 'author')[0]?.author).toBe('Ada');
  });

  it('filters by status', () => {
    const open = arrangeComments(comments, { ...DEFAULT_FILTER, status: 'open' }, 'page');
    expect(open.map((entry) => entry.id)).toEqual(['a', 'c']);

    const done = arrangeComments(comments, { ...DEFAULT_FILTER, status: 'resolved' }, 'page');
    expect(done.map((entry) => entry.id)).toEqual(['b']);
  });

  it('filters by kind and by author', () => {
    expect(
      arrangeComments(comments, { ...DEFAULT_FILTER, kinds: ['highlight'] }, 'page').map(
        (entry) => entry.id,
      ),
    ).toEqual(['b']);

    expect(
      arrangeComments(comments, { ...DEFAULT_FILTER, authors: ['Zoe'] }, 'page').map(
        (entry) => entry.id,
      ),
    ).toEqual(['a']);
  });

  it('lists the authors present, and calls an unsigned comment unknown', () => {
    expect(authorsOf([...comments, comment({ id: 'd', author: '' })])).toEqual([
      'Ada',
      'Unknown',
      'Zoe',
    ]);
  });
});
