import { PDFName, PDFString, type PDFFont } from 'pdf-lib';
import type { AnnotationInput, AnnotationRect } from '@shared/schemas/annotation';
import { formatMeasurement, measure, measuredPoints } from '@shared/utils/measure';

/**
 * What makes a line, polyline or polygon a measurement in the file.
 *
 * `/IT` names the kind — `LineDimension`, `PolyLineDimension` or
 * `PolygonDimension` — and `/Measure` carries the scale as a rectilinear
 * measure dictionary, so another reader that understands measurements works
 * from the same numbers. The value is written as the comment and drawn as a
 * caption beside the shape, so a reader that does not still shows it.
 */

const INTENTS = {
  distance: 'LineDimension',
  perimeter: 'PolyLineDimension',
  area: 'PolygonDimension',
} as const;

export const MEASURE_INTENTS: ReadonlyMap<string, keyof typeof INTENTS> = new Map(
  Object.entries(INTENTS).map(([kind, intent]) => [intent, kind as keyof typeof INTENTS]),
);

export interface MeasureDrawing {
  /** The value as text, which becomes the annotation's comment. */
  text: string;
  caption: { text: string; size: number; x: number; y: number };
  /** Where the caption is drawn, so the annotation's box can take it in. */
  captionBox: AnnotationRect;
  /** Entries for the annotation dictionary. */
  entries: Record<string, unknown>;
}

export function measureDrawing(input: AnnotationInput, font: PDFFont): MeasureDrawing | null {
  const measurement = input.measure;
  if (measurement === undefined) return null;
  const points = measuredPoints(input.geometry);
  if (points.length < 2) return null;

  const { scale } = measurement;
  const value = measure(measurement.kind, points, scale);
  const text = formatMeasurement(value, measurement.kind, scale.unit);

  const size = Math.max(6, Math.min(36, input.style.fontSize));
  const width = widthOf(font, text, size);
  const anchor = anchorOf(measurement.kind, points);
  const x = anchor.x - width / 2;
  // A length is captioned just above its line; an area in its middle.
  const y = measurement.kind === 'area' ? anchor.y - size * 0.35 : anchor.y + 3;

  const format = (unit: string): Record<string, unknown> => ({
    Type: PDFName.of('NumberFormat'),
    U: PDFString.of(unit),
    C: 1,
    D: 100,
  });

  return {
    text,
    caption: { text, size, x, y },
    captionBox: { x: x - 2, y: y - size * 0.3, width: width + 4, height: size * 1.3 },
    entries: {
      IT: PDFName.of(INTENTS[measurement.kind]),
      ...(measurement.kind === 'distance' ? { Cap: true } : {}),
      Measure: {
        Type: PDFName.of('Measure'),
        Subtype: PDFName.of('RL'),
        R: PDFString.of(scale.label),
        X: [{ ...format(scale.unit), C: scale.factor }],
        D: [format(scale.unit)],
        A: [format(`sq ${scale.unit}`)],
      },
    },
  };
}

function anchorOf(
  kind: keyof typeof INTENTS,
  points: readonly { x: number; y: number }[],
): { x: number; y: number } {
  if (kind === 'area') {
    const total = points.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), {
      x: 0,
      y: 0,
    });
    return { x: total.x / points.length, y: total.y / points.length };
  }
  // The middle of the middle segment.
  const segment = Math.max(0, Math.floor((points.length - 2) / 2));
  const from = points[segment] as { x: number; y: number };
  const to = points[segment + 1] as { x: number; y: number };
  return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
}

function widthOf(font: PDFFont, text: string, size: number): number {
  try {
    return font.widthOfTextAtSize(text, size);
  } catch {
    return text.length * size * 0.5;
  }
}

/** The smallest rectangle holding both. */
export function unionRect(first: AnnotationRect, second: AnnotationRect): AnnotationRect {
  const x = Math.min(first.x, second.x);
  const y = Math.min(first.y, second.y);
  return {
    x,
    y,
    width: Math.max(first.x + first.width, second.x + second.width) - x,
    height: Math.max(first.y + first.height, second.y + second.height) - y,
  };
}
