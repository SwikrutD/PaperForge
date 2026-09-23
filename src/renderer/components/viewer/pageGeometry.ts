import type { PdfPageGeometry } from '@pdf/render/types';

/** A rectangle in PDF user space: origin bottom-left, y growing upwards. */
export interface PdfRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A box on the rendered page, in CSS pixels from its top-left corner. */
export interface CssBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Quarter turns clockwise, normalized to 0–3. */
export function quarterTurns(degrees: number): 0 | 1 | 2 | 3 {
  const turns = ((Math.round(degrees / 90) % 4) + 4) % 4;
  return turns as 0 | 1 | 2 | 3;
}

/** A rect from two opposite corners, in any order — how PDFs write them. */
export function rectFromCorners(corners: readonly [number, number, number, number]): PdfRect {
  const [x1, y1, x2, y2] = corners;
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}

/**
 * Places a PDF-space rectangle on the page as it is displayed.
 *
 * PDF user space measures from the bottom-left of the unrotated page; CSS
 * measures from the top-left of the page after both the page's own rotation
 * and the reader's view rotation. This mirrors the transform PDF.js builds for
 * a viewport, so highlights and link hotspots land exactly on the canvas.
 *
 * Returns null for an empty rectangle, which nothing needs to draw.
 */
export function pdfRectToCss(
  rect: PdfRect,
  geometry: PdfPageGeometry,
  scale: number,
  viewRotation: number,
): CssBox | null {
  if (rect.width <= 0 || rect.height <= 0) return null;

  const [originX, originY, cornerX, cornerY] = geometry.viewBox;
  // Page-local coordinates: a view box does not have to start at zero.
  const x = rect.x - originX;
  const y = rect.y - originY;
  const width = cornerX - originX;
  const height = cornerY - originY;
  const unit = scale * (geometry.userUnit === 0 ? 1 : geometry.userUnit);

  const box = (left: number, top: number, boxWidth: number, boxHeight: number): CssBox => ({
    left: left * unit,
    top: top * unit,
    width: boxWidth * unit,
    height: boxHeight * unit,
  });

  switch (quarterTurns(geometry.rotation + viewRotation)) {
    case 1:
      return box(y, x, rect.height, rect.width);
    case 2:
      return box(width - (x + rect.width), y, rect.width, rect.height);
    case 3:
      return box(height - (y + rect.height), width - (x + rect.width), rect.height, rect.width);
    default:
      return box(x, height - (y + rect.height), rect.width, rect.height);
  }
}

/** The same box as CSS properties, ready to spread onto a style object. */
export function cssBoxStyle(box: CssBox): {
  left: string;
  top: string;
  width: string;
  height: string;
} {
  return {
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
  };
}

/**
 * The other direction: a point on the rendered page back into PDF user space.
 *
 * This is what turns a click or a drag into geometry an annotation can be
 * written from, and it is the exact inverse of `pdfRectToCss`.
 */
export function cssPointToPdf(
  point: { x: number; y: number },
  geometry: PdfPageGeometry,
  scale: number,
  viewRotation: number,
): { x: number; y: number } {
  const [originX, originY, cornerX, cornerY] = geometry.viewBox;
  const width = cornerX - originX;
  const height = cornerY - originY;
  const unit = scale * (geometry.userUnit === 0 ? 1 : geometry.userUnit);
  const cssX = point.x / unit;
  const cssY = point.y / unit;

  switch (quarterTurns(geometry.rotation + viewRotation)) {
    case 1:
      return { x: cssY + originX, y: cssX + originY };
    case 2:
      return { x: width - cssX + originX, y: cssY + originY };
    case 3:
      return { x: width - cssY + originX, y: height - cssX + originY };
    default:
      return { x: cssX + originX, y: height - cssY + originY };
  }
}

/** A rectangle on the rendered page, back in PDF user space. */
export function cssRectToPdf(
  box: { left: number; top: number; width: number; height: number },
  geometry: PdfPageGeometry,
  scale: number,
  viewRotation: number,
): PdfRect {
  const first = cssPointToPdf({ x: box.left, y: box.top }, geometry, scale, viewRotation);
  const second = cssPointToPdf(
    { x: box.left + box.width, y: box.top + box.height },
    geometry,
    scale,
    viewRotation,
  );

  return {
    x: Math.min(first.x, second.x),
    y: Math.min(first.y, second.y),
    width: Math.abs(second.x - first.x),
    height: Math.abs(second.y - first.y),
  };
}
