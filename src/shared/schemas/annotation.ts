import { z } from 'zod';

/**
 * The annotation vocabulary.
 *
 * Everything here maps onto a real PDF annotation: a kind is a `/Subtype`
 * (sometimes with an `/IT` or `/LE` that distinguishes a variant), geometry is
 * in the page's own user space, and the style fields are the entries a PDF
 * annotation dictionary actually carries. Nothing is kept in an app-private
 * store, so what PaperForge writes is what every other reader sees.
 */

/** Every annotation kind PaperForge can create today. */
export const annotationKindSchema = z.enum([
  // Text markup, made from a selection.
  'highlight',
  'underline',
  'strikeOut',
  'squiggly',
  // Notes and text.
  'note',
  'freeText',
  'callout',
  // Shapes.
  'square',
  'circle',
  'line',
  'arrow',
  'polygon',
  'polyline',
  // Freehand and stamps.
  'ink',
  'stamp',
  'imageStamp',
]);
export type AnnotationKind = z.infer<typeof annotationKindSchema>;

/** Kinds that come from selected text rather than from a drag. */
export const TEXT_MARKUP_KINDS = ['highlight', 'underline', 'strikeOut', 'squiggly'] as const;

const coordinate = z.number().finite().min(-1_000_000).max(1_000_000);

export const pointSchema = z.strictObject({ x: coordinate, y: coordinate });
export type AnnotationPoint = z.infer<typeof pointSchema>;

/** A rectangle in PDF user space: origin bottom-left, y growing upwards. */
export const annotationRectSchema = z.strictObject({
  x: coordinate,
  y: coordinate,
  width: z.number().finite().min(0).max(1_000_000),
  height: z.number().finite().min(0).max(1_000_000),
});
export type AnnotationRect = z.infer<typeof annotationRectSchema>;

/**
 * One quadrilateral of marked text, as `/QuadPoints` orders them: upper-left,
 * upper-right, lower-left, lower-right.
 */
export const quadSchema = z.array(coordinate).length(8);
export type AnnotationQuad = z.infer<typeof quadSchema>;

const markupGeometrySchema = z.strictObject({
  kind: z.enum(TEXT_MARKUP_KINDS),
  quads: z.array(quadSchema).min(1).max(4000),
});

const noteGeometrySchema = z.strictObject({
  kind: z.literal('note'),
  point: pointSchema,
});

const boxGeometrySchema = z.strictObject({
  kind: z.enum(['freeText', 'square', 'circle', 'stamp', 'imageStamp']),
  rect: annotationRectSchema,
});

const calloutGeometrySchema = z.strictObject({
  kind: z.literal('callout'),
  rect: annotationRectSchema,
  /** The callout line: where it points, an optional knee, and where it meets the box. */
  callout: z.array(pointSchema).min(2).max(3),
});

const lineGeometrySchema = z.strictObject({
  kind: z.enum(['line', 'arrow']),
  from: pointSchema,
  to: pointSchema,
});

const pathGeometrySchema = z.strictObject({
  kind: z.enum(['polygon', 'polyline']),
  vertices: z.array(pointSchema).min(2).max(2000),
});

const inkGeometrySchema = z.strictObject({
  kind: z.literal('ink'),
  strokes: z.array(z.array(pointSchema).min(1).max(5000)).min(1).max(500),
});

export const annotationGeometrySchema = z.discriminatedUnion('kind', [
  markupGeometrySchema,
  noteGeometrySchema,
  boxGeometrySchema,
  calloutGeometrySchema,
  lineGeometrySchema,
  pathGeometrySchema,
  inkGeometrySchema,
]);
export type AnnotationGeometry = z.infer<typeof annotationGeometrySchema>;

/** Colour components in 0–1, the range PDF itself uses. */
export const colorSchema = z.strictObject({
  r: z.number().min(0).max(1),
  g: z.number().min(0).max(1),
  b: z.number().min(0).max(1),
});
export type AnnotationColor = z.infer<typeof colorSchema>;

export const borderStyleSchema = z.enum(['solid', 'dashed']);
export type AnnotationBorderStyle = z.infer<typeof borderStyleSchema>;

export const annotationStyleSchema = z.strictObject({
  /** Stroke, and the mark's colour for text markup. */
  color: colorSchema,
  opacity: z.number().min(0.05).max(1),
  borderWidth: z.number().min(0).max(72),
  borderStyle: borderStyleSchema,
  /** Interior colour; null leaves a shape unfilled. */
  fillColor: colorSchema.nullable(),
  fontSize: z.number().min(4).max(144),
  textColor: colorSchema,
});
export type AnnotationStyle = z.infer<typeof annotationStyleSchema>;

export const DEFAULT_ANNOTATION_STYLE: AnnotationStyle = {
  color: { r: 0.95, g: 0.77, b: 0.06 },
  opacity: 1,
  borderWidth: 2,
  borderStyle: 'solid',
  fillColor: null,
  fontSize: 12,
  textColor: { r: 0.1, g: 0.1, b: 0.1 },
};

export const measurementKindSchema = z.enum(['distance', 'perimeter', 'area']);
export type MeasurementKind = z.infer<typeof measurementKindSchema>;

/**
 * How many real units one PDF point stands for, written into the annotation's
 * `/Measure` dictionary so other readers measure with the same scale.
 */
export const measurementScaleSchema = z.strictObject({
  factor: z.number().finite().positive().max(1e12),
  unit: z.string().min(1).max(12),
  /** The scale as a drawing states it, e.g. "1 in = 4 ft". */
  label: z.string().max(80),
});
export type MeasurementScale = z.infer<typeof measurementScaleSchema>;

/**
 * A measurement: a line (distance), polyline (perimeter) or polygon (area)
 * annotation with `/IT` saying which and `/Measure` saying at what scale.
 */
export const measurementSchema = z.strictObject({
  kind: measurementKindSchema,
  scale: measurementScaleSchema,
});
export type Measurement = z.infer<typeof measurementSchema>;

/** What is needed to create one annotation. */
export const annotationInputSchema = z.strictObject({
  pageNumber: z.number().int().min(1).max(100_000),
  geometry: annotationGeometrySchema,
  style: annotationStyleSchema,
  /** The comment itself, and the text a free text or callout box shows. */
  contents: z.string().max(20_000),
  author: z.string().max(200),
  subject: z.string().max(200),
  /** Label of a built-in stamp, e.g. "Approved". */
  stampLabel: z.string().max(60).optional(),
  /**
   * An image staged for an image stamp, by the token the main process gave
   * out. The bytes never travel over IPC.
   */
  imageToken: z.string().max(200).optional(),
  /** Makes the line, polyline or polygon a measurement. */
  measure: measurementSchema.optional(),
});
export type AnnotationInput = z.infer<typeof annotationInputSchema>;

/** An annotation as it exists in the document. */
export const annotationSchema = annotationInputSchema.extend({
  /** Stable identity, written to the annotation's `/NM` entry. */
  id: z.string().min(1).max(120),
  createdAt: z.string().nullable(),
  modifiedAt: z.string().nullable(),
  /**
   * Marked as dealt with. PDF has no portable "resolved" flag, so this is
   * PaperForge metadata: other readers ignore it, and it survives a round trip
   * through PaperForge.
   */
  resolved: z.boolean(),
  /** False for an annotation PaperForge can list but not edit or redraw. */
  editable: z.boolean(),
});
export type Annotation = z.infer<typeof annotationSchema>;

/** Fields of an existing annotation that can be changed. */
export const annotationPatchSchema = z.strictObject({
  style: annotationStyleSchema.partial().optional(),
  geometry: annotationGeometrySchema.optional(),
  contents: z.string().max(20_000).optional(),
  author: z.string().max(200).optional(),
  subject: z.string().max(200).optional(),
  resolved: z.boolean().optional(),
});
export type AnnotationPatch = z.infer<typeof annotationPatchSchema>;

/** An image staged for stamping, and the size it wants to be placed at. */
export const stampImageSchema = z.strictObject({
  token: z.string().min(1).max(200),
  fileName: z.string().min(1).max(260),
  width: z.number().positive(),
  height: z.number().positive(),
});
export type StampImage = z.infer<typeof stampImageSchema>;

/** The built-in stamps, which are drawn rather than shipped as images. */
export const BUILT_IN_STAMPS = [
  'Approved',
  'Reviewed',
  'Draft',
  'Confidential',
  'Final',
  'For comment',
] as const;
export type BuiltInStamp = (typeof BUILT_IN_STAMPS)[number];
