import type {
  Annotation,
  AnnotationGeometry,
  AnnotationKind,
  AnnotationPoint,
  AnnotationRect,
} from '@shared/schemas/annotation';
import { quadFromRect, rectFromDrag } from '@pdf/mutate/annotations/geometry';
import type { CommentFilter, CommentSort } from '../../stores/annotationStore';

/**
 * Turning what the reader does with the pointer into annotation geometry, and
 * the arithmetic the comments panel sorts and filters by.
 *
 * All of it is pure: no React, no DOM, no PDF library, so the awkward parts —
 * what a tiny drag means, how a text selection becomes quads — can be tested
 * directly.
 */

/** Smaller than this is a click rather than a drag, in PDF units. */
export const DRAG_THRESHOLD = 3;

/** Size a text box, stamp or note gets when it is placed with a click. */
export const DEFAULT_TEXT_BOX = { width: 200, height: 64 };
export const DEFAULT_STAMP = { width: 150, height: 48 };

/** Tools that are drawn by dragging out a shape. */
export const DRAG_TOOLS: readonly AnnotationKind[] = [
  'square',
  'circle',
  'line',
  'arrow',
  'freeText',
  'callout',
  'stamp',
  'imageStamp',
];

/** Tools that collect a path as the pointer moves. */
export const PATH_TOOLS: readonly AnnotationKind[] = ['ink', 'polygon', 'polyline'];

/** Tools made from selected text rather than from the pointer. */
export const MARKUP_TOOLS: readonly AnnotationKind[] = [
  'highlight',
  'underline',
  'strikeOut',
  'squiggly',
];

export function isDragTool(tool: string): tool is AnnotationKind {
  return DRAG_TOOLS.includes(tool as AnnotationKind);
}

export function isPathTool(tool: string): tool is AnnotationKind {
  return PATH_TOOLS.includes(tool as AnnotationKind);
}

export function isMarkupTool(tool: string): tool is AnnotationKind {
  return MARKUP_TOOLS.includes(tool as AnnotationKind);
}

/**
 * The geometry a drag produces.
 *
 * A drag that never really moved becomes a default-sized shape at the point of
 * the click, so a single click still places something rather than creating an
 * annotation with no area.
 */
export function geometryFromDrag(
  kind: AnnotationKind,
  from: AnnotationPoint,
  to: AnnotationPoint,
  size?: { width: number; height: number },
): AnnotationGeometry | null {
  const moved = Math.hypot(to.x - from.x, to.y - from.y) >= DRAG_THRESHOLD;

  switch (kind) {
    case 'line':
    case 'arrow':
      return moved ? { kind, from, to } : null;

    case 'square':
    case 'circle':
      return moved ? { kind, rect: rectFromDrag(from, to) } : null;

    case 'freeText':
      return {
        kind,
        rect: moved ? rectFromDrag(from, to) : boxAt(from, DEFAULT_TEXT_BOX),
      };

    case 'callout': {
      // The line points from where the reader pressed to a box beside it.
      const box = boxAt({ x: from.x + 60, y: from.y + 70 }, DEFAULT_TEXT_BOX);
      const knee = { x: from.x + 30, y: from.y + 35 };
      return {
        kind,
        rect: moved ? rectFromDrag({ x: from.x + 60, y: from.y + 70 }, to) : box,
        callout: [from, knee, { x: box.x, y: box.y + box.height / 2 }],
      };
    }

    case 'stamp':
      return { kind, rect: moved ? rectFromDrag(from, to) : boxAt(from, DEFAULT_STAMP) };

    case 'imageStamp': {
      const placed = size ?? DEFAULT_STAMP;
      return { kind, rect: moved ? rectFromDrag(from, to) : boxAt(from, placed) };
    }

    default:
      return null;
  }
}

/** A box hanging below and to the right of a point, the way a click reads. */
function boxAt(point: AnnotationPoint, size: { width: number; height: number }): AnnotationRect {
  return { x: point.x, y: point.y - size.height, width: size.width, height: size.height };
}

/** The geometry a path tool produces, once the points are in. */
export function geometryFromPath(
  kind: AnnotationKind,
  points: readonly AnnotationPoint[],
): AnnotationGeometry | null {
  if (kind === 'ink') {
    return points.length === 0 ? null : { kind, strokes: [[...points]] };
  }
  if (kind === 'polygon' || kind === 'polyline') {
    return points.length < 2 ? null : { kind, vertices: [...points] };
  }
  return null;
}

/** Adds another stroke to an ink annotation, for a second pass of the pen. */
export function withExtraStroke(
  geometry: AnnotationGeometry,
  stroke: readonly AnnotationPoint[],
): AnnotationGeometry {
  if (geometry.kind !== 'ink' || stroke.length === 0) return geometry;
  return { ...geometry, strokes: [...geometry.strokes, [...stroke]] };
}

/**
 * Quads for text markup, from rectangles the browser reports for a selection.
 *
 * Rectangles that are empty, or that belong to another page, are dropped by
 * the caller; what arrives here is already in PDF user space.
 */
export function quadsFromRects(rects: readonly AnnotationRect[]): number[][] {
  return rects
    .filter((rect) => rect.width > 0.5 && rect.height > 0.5)
    .map((rect) => quadFromRect(rect));
}

/** Everything the comments panel shows, in the order it shows it. */
export function arrangeComments(
  annotations: readonly Annotation[],
  filter: CommentFilter,
  sort: CommentSort,
): Annotation[] {
  const kept = annotations.filter((annotation) => {
    if (filter.kinds.length > 0 && !filter.kinds.includes(annotation.geometry.kind)) return false;
    if (filter.authors.length > 0 && !filter.authors.includes(authorOf(annotation))) return false;
    if (filter.status === 'open' && annotation.resolved) return false;
    if (filter.status === 'resolved' && !annotation.resolved) return false;
    return true;
  });

  const ordered = [...kept];
  switch (sort) {
    case 'newest':
      ordered.sort((a, b) => timeOf(b) - timeOf(a));
      break;
    case 'author':
      ordered.sort((a, b) => authorOf(a).localeCompare(authorOf(b)) || a.pageNumber - b.pageNumber);
      break;
    default:
      ordered.sort((a, b) => a.pageNumber - b.pageNumber || timeOf(a) - timeOf(b));
  }
  return ordered;
}

/** The authors present, for the filter to offer. */
export function authorsOf(annotations: readonly Annotation[]): string[] {
  return [...new Set(annotations.map(authorOf))].sort((a, b) => a.localeCompare(b));
}

export function authorOf(annotation: Annotation): string {
  return annotation.author === '' ? 'Unknown' : annotation.author;
}

function timeOf(annotation: Annotation): number {
  const value = annotation.createdAt ?? annotation.modifiedAt;
  const time = value === null ? Number.NaN : Date.parse(value);
  return Number.isNaN(time) ? 0 : time;
}

/** Every kind that has a tool, which is what the filter can offer. */
export const TOOL_KINDS: readonly AnnotationKind[] = [
  ...MARKUP_TOOLS,
  'note',
  'freeText',
  'callout',
  ...DRAG_TOOLS.filter((kind) => kind !== 'freeText' && kind !== 'callout'),
  ...PATH_TOOLS,
];
