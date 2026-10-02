import type {
  AnnotationGeometry,
  AnnotationPoint,
  MeasurementKind,
  MeasurementScale,
} from '../schemas/annotation';

/**
 * Measuring on the page.
 *
 * Geometry is in PDF points, 72 to the inch. A scale says how many real units
 * one point stands for: the page's own size by default, or whatever the reader
 * calibrated it to from a length they know.
 */

/** Units a measurement can be given in, and how many points each is on paper. */
export const MEASUREMENT_UNITS = ['mm', 'cm', 'm', 'km', 'in', 'ft', 'yd', 'mi', 'pt'] as const;
export type MeasurementUnit = (typeof MEASUREMENT_UNITS)[number];

const POINTS_PER_UNIT: Record<MeasurementUnit, number> = {
  pt: 1,
  in: 72,
  ft: 72 * 12,
  yd: 72 * 36,
  mi: 72 * 63_360,
  mm: 72 / 25.4,
  cm: 72 / 2.54,
  m: 7200 / 2.54,
  km: 7_200_000 / 2.54,
};

export function isMeasurementUnit(value: string): value is MeasurementUnit {
  return (MEASUREMENT_UNITS as readonly string[]).includes(value);
}

/** The page measured as it is printed, in the unit given. */
export function actualSizeScale(unit: MeasurementUnit): MeasurementScale {
  return { factor: 1 / POINTS_PER_UNIT[unit], unit, label: `1 ${unit} = 1 ${unit}` };
}

/**
 * The scale that makes a line of `lengthPoints` measure `realLength` units.
 * The label reads the way a drawing's scale bar does: one inch on the paper
 * is so much in the world.
 */
export function calibratedScale(
  lengthPoints: number,
  realLength: number,
  unit: MeasurementUnit,
): MeasurementScale | null {
  if (!(lengthPoints > 0) || !(realLength > 0) || !Number.isFinite(realLength)) return null;
  const factor = realLength / lengthPoints;
  return { factor, unit, label: `1 in = ${formatNumber(factor * 72)} ${unit}` };
}

export function distanceBetween(from: AnnotationPoint, to: AnnotationPoint): number {
  return Math.hypot(to.x - from.x, to.y - from.y);
}

/** The length of a path through the points, open. */
export function pathLength(points: readonly AnnotationPoint[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += distanceBetween(
      points[index - 1] as AnnotationPoint,
      points[index] as AnnotationPoint,
    );
  }
  return total;
}

/** The area a closed polygon encloses, by the shoelace formula, in square points. */
export function polygonArea(points: readonly AnnotationPoint[]): number {
  let twice = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index] as AnnotationPoint;
    const next = points[(index + 1) % points.length] as AnnotationPoint;
    twice += current.x * next.y - next.x * current.y;
  }
  return Math.abs(twice) / 2;
}

/** The points a measurement's geometry runs through, in order. */
export function measuredPoints(geometry: AnnotationGeometry): AnnotationPoint[] {
  if (geometry.kind === 'line' || geometry.kind === 'arrow') return [geometry.from, geometry.to];
  if (geometry.kind === 'polygon' || geometry.kind === 'polyline') return [...geometry.vertices];
  return [];
}

/** What a measurement comes to, in its scale's unit (squared, for an area). */
export function measure(
  kind: MeasurementKind,
  points: readonly AnnotationPoint[],
  scale: MeasurementScale,
): number {
  if (kind === 'area') return polygonArea(points) * scale.factor * scale.factor;
  return pathLength(points) * scale.factor;
}

/** "12.5 ft", "3.04 sq m". */
export function formatMeasurement(value: number, kind: MeasurementKind, unit: string): string {
  return kind === 'area' ? `${formatNumber(value)} sq ${unit}` : `${formatNumber(value)} ${unit}`;
}

/** Three significant figures after the point is plenty for a drawing. */
function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const magnitude = Math.abs(value);
  const digits = magnitude >= 100 ? 1 : magnitude >= 1 ? 2 : 3;
  return Number(value.toFixed(digits)).toString();
}

/** The geometry a measurement is written as. */
export function geometryKindFor(kind: MeasurementKind): 'line' | 'polyline' | 'polygon' {
  return kind === 'distance' ? 'line' : kind === 'perimeter' ? 'polyline' : 'polygon';
}
