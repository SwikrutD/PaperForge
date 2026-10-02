import { applyMatrix, type Matrix } from '../content/state';

/**
 * The geometry redaction decides with.
 *
 * Everything is in PDF user space. A mark is a set of upright rectangles; what
 * it covers is decided by how much of a glyph, picture or path falls inside
 * one of them.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * How much of a glyph has to lie under a mark for it to go. A glyph whose
 * middle is under the mark goes whatever this says; this catches the glyph a
 * mark covers most of without quite reaching its middle.
 */
export const GLYPH_COVERAGE = 0.3;

/** Slack for "inside", because a mark drawn round an object rarely fits it exactly. */
export const CONTAINMENT_TOLERANCE = 0.5;

/** The upright box a set of points occupies. */
export function boundsOfPoints(points: readonly Point[]): Rect {
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let left = Infinity;
  let bottom = Infinity;
  let right = -Infinity;
  let top = -Infinity;
  for (const point of points) {
    left = Math.min(left, point.x);
    bottom = Math.min(bottom, point.y);
    right = Math.max(right, point.x);
    top = Math.max(top, point.y);
  }
  return { x: left, y: bottom, width: right - left, height: top - bottom };
}

/** The upright box a rectangle in some other space occupies once transformed. */
export function transformRect(matrix: Matrix, rect: Rect): Rect {
  return boundsOfPoints([
    applyMatrix(matrix, rect.x, rect.y),
    applyMatrix(matrix, rect.x + rect.width, rect.y),
    applyMatrix(matrix, rect.x, rect.y + rect.height),
    applyMatrix(matrix, rect.x + rect.width, rect.y + rect.height),
  ]);
}

export function area(rect: Rect): number {
  return Math.max(0, rect.width) * Math.max(0, rect.height);
}

/** The area two rectangles share. */
export function overlapArea(first: Rect, second: Rect): number {
  const width =
    Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x);
  const height =
    Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y);
  return width > 0 && height > 0 ? width * height : 0;
}

/**
 * True when two rectangles share any area at all. A rectangle with no width
 * or height — a hairline, a zero-width glyph — shares area with nothing, so it
 * is tested as the line or point it is.
 */
export function touches(first: Rect, second: Rect): boolean {
  return (
    first.x <= second.x + second.width &&
    second.x <= first.x + first.width &&
    first.y <= second.y + second.height &&
    second.y <= first.y + first.height &&
    (overlapArea(first, second) > 0 || area(first) === 0 || area(second) === 0)
  );
}

export function containsPoint(rect: Rect, point: Point): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

/** True when `inner` lies inside `outer`, give or take the tolerance. */
export function containsRect(outer: Rect, inner: Rect, tolerance = CONTAINMENT_TOLERANCE): boolean {
  return (
    inner.x >= outer.x - tolerance &&
    inner.y >= outer.y - tolerance &&
    inner.x + inner.width <= outer.x + outer.width + tolerance &&
    inner.y + inner.height <= outer.y + outer.height + tolerance
  );
}

/** True when any one of the marks holds the whole of `inner`. */
export function containedByAny(marks: readonly Rect[], inner: Rect): boolean {
  return marks.some((mark) => containsRect(mark, inner));
}

export function touchesAny(marks: readonly Rect[], rect: Rect): boolean {
  return marks.some((mark) => touches(mark, rect));
}

/** Grows a rectangle by the same amount on every side. */
export function inflate(rect: Rect, amount: number): Rect {
  return {
    x: rect.x - amount,
    y: rect.y - amount,
    width: rect.width + amount * 2,
    height: rect.height + amount * 2,
  };
}

/** The smallest rectangle holding both. */
export function union(first: Rect, second: Rect): Rect {
  const x = Math.min(first.x, second.x);
  const y = Math.min(first.y, second.y);
  return {
    x,
    y,
    width: Math.max(first.x + first.width, second.x + second.width) - x,
    height: Math.max(first.y + first.height, second.y + second.height) - y,
  };
}
