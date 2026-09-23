import type {
  AnnotationGeometry,
  AnnotationPoint,
  AnnotationRect,
} from '@shared/schemas/annotation';

/**
 * Geometry arithmetic for annotations: the rectangle each kind occupies, and
 * the moves the editor makes on it. All of it is in PDF user space, and none
 * of it touches a PDF library, so it can be reasoned about on its own.
 */

/** How far a sticky note's icon reaches, in PDF units. */
export const NOTE_SIZE = 20;

/** Space left around ink and shapes so a thick stroke is not clipped. */
function padding(borderWidth: number): number {
  return Math.max(1, borderWidth) + 1;
}

export function rectFromPoints(points: readonly AnnotationPoint[], pad = 0): AnnotationRect {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 };
  return {
    x: minX - pad,
    y: minY - pad,
    width: maxX - minX + pad * 2,
    height: maxY - minY + pad * 2,
  };
}

/** The `/Rect` an annotation needs: everything it draws has to fit inside. */
export function boundsOf(geometry: AnnotationGeometry, borderWidth = 1): AnnotationRect {
  switch (geometry.kind) {
    case 'highlight':
    case 'underline':
    case 'strikeOut':
    case 'squiggly': {
      const points = geometry.quads.flatMap((quad) => quadPoints(quad));
      return rectFromPoints(points, 1);
    }
    case 'note':
      return {
        x: geometry.point.x,
        y: geometry.point.y - NOTE_SIZE,
        width: NOTE_SIZE,
        height: NOTE_SIZE,
      };
    case 'freeText':
    case 'square':
    case 'circle':
    case 'stamp':
    case 'imageStamp':
      return inflate(geometry.rect, geometry.kind === 'freeText' ? 0 : padding(borderWidth) / 2);
    case 'callout':
      return rectFromPoints([...corners(geometry.rect), ...geometry.callout], padding(borderWidth));
    case 'line':
    case 'arrow':
      return rectFromPoints([geometry.from, geometry.to], padding(borderWidth) * 3);
    case 'polygon':
    case 'polyline':
      return rectFromPoints(geometry.vertices, padding(borderWidth));
    case 'ink':
      return rectFromPoints(geometry.strokes.flat(), padding(borderWidth));
  }
}

/** The four corners of a rectangle, anticlockwise from the bottom left. */
export function corners(rect: AnnotationRect): AnnotationPoint[] {
  return [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ];
}

/** A quad as its four corner points, in the order `/QuadPoints` states them. */
export function quadPoints(quad: readonly number[]): AnnotationPoint[] {
  const points: AnnotationPoint[] = [];
  for (let index = 0; index + 1 < quad.length; index += 2) {
    points.push({ x: quad[index] as number, y: quad[index + 1] as number });
  }
  return points;
}

/** Upper-left, upper-right, lower-left, lower-right of a quad. */
export function quadCorners(quad: readonly number[]): {
  upperLeft: AnnotationPoint;
  upperRight: AnnotationPoint;
  lowerLeft: AnnotationPoint;
  lowerRight: AnnotationPoint;
} {
  const [ulx = 0, uly = 0, urx = 0, ury = 0, llx = 0, lly = 0, lrx = 0, lry = 0] = quad;
  return {
    upperLeft: { x: ulx, y: uly },
    upperRight: { x: urx, y: ury },
    lowerLeft: { x: llx, y: lly },
    lowerRight: { x: lrx, y: lry },
  };
}

/** A quad from a rectangle, which is how a selection rectangle becomes markup. */
export function quadFromRect(rect: AnnotationRect): number[] {
  const top = rect.y + rect.height;
  const right = rect.x + rect.width;
  return [rect.x, top, right, top, rect.x, rect.y, right, rect.y];
}

export function inflate(rect: AnnotationRect, by: number): AnnotationRect {
  return {
    x: rect.x - by,
    y: rect.y - by,
    width: Math.max(0, rect.width + by * 2),
    height: Math.max(0, rect.height + by * 2),
  };
}

/** Moves every point of an annotation, for dragging it around the page. */
export function translateGeometry(
  geometry: AnnotationGeometry,
  dx: number,
  dy: number,
): AnnotationGeometry {
  const movePoint = (point: AnnotationPoint): AnnotationPoint => ({
    x: point.x + dx,
    y: point.y + dy,
  });
  const moveRect = (rect: AnnotationRect): AnnotationRect => ({
    ...rect,
    x: rect.x + dx,
    y: rect.y + dy,
  });

  switch (geometry.kind) {
    case 'highlight':
    case 'underline':
    case 'strikeOut':
    case 'squiggly':
      return {
        ...geometry,
        quads: geometry.quads.map((quad) =>
          quad.map((value, index) => (index % 2 === 0 ? value + dx : value + dy)),
        ),
      };
    case 'note':
      return { ...geometry, point: movePoint(geometry.point) };
    case 'freeText':
    case 'square':
    case 'circle':
    case 'stamp':
    case 'imageStamp':
      return { ...geometry, rect: moveRect(geometry.rect) };
    case 'callout':
      return {
        ...geometry,
        rect: moveRect(geometry.rect),
        callout: geometry.callout.map(movePoint),
      };
    case 'line':
    case 'arrow':
      return { ...geometry, from: movePoint(geometry.from), to: movePoint(geometry.to) };
    case 'polygon':
    case 'polyline':
      return { ...geometry, vertices: geometry.vertices.map(movePoint) };
    case 'ink':
      return { ...geometry, strokes: geometry.strokes.map((stroke) => stroke.map(movePoint)) };
  }
}

/**
 * Resizes an annotation to a new rectangle, where that is meaningful.
 *
 * Text markup is tied to the words it marks and ink to the movement of the
 * hand, so neither is scaled: those are moved, not resized.
 */
export function resizeGeometry(
  geometry: AnnotationGeometry,
  rect: AnnotationRect,
): AnnotationGeometry | null {
  switch (geometry.kind) {
    case 'freeText':
    case 'square':
    case 'circle':
    case 'stamp':
    case 'imageStamp':
      return { ...geometry, rect };
    case 'callout':
      return { ...geometry, rect };
    case 'line':
    case 'arrow':
      return {
        ...geometry,
        from: { x: rect.x, y: rect.y },
        to: { x: rect.x + rect.width, y: rect.y + rect.height },
      };
    default:
      return null;
  }
}

/** True when a point is inside the rectangle, used for hit testing. */
export function rectContains(rect: AnnotationRect, point: AnnotationPoint): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

/** A rectangle from two dragged corners, in any order. */
export function rectFromDrag(from: AnnotationPoint, to: AnnotationPoint): AnnotationRect {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  };
}
