import { z } from 'zod';
import { textStyleSchema } from './text';

/**
 * Page furniture: watermarks, backgrounds, headers and footers.
 *
 * All of it is drawn by PaperForge and marked as its own, so it can be
 * changed or taken off again later. None of it touches what the document
 * itself draws.
 */

export const furnitureKindSchema = z.enum([
  'watermark',
  'background',
  'header',
  'footer',
  /** The words recognised from a scan. */
  'ocr',
]);
export type FurnitureKindName = z.infer<typeof furnitureKindSchema>;

export const furniturePositionSchema = z.strictObject({
  horizontal: z.enum(['left', 'center', 'right']),
  vertical: z.enum(['top', 'middle', 'bottom']),
});
export type FurniturePosition = z.infer<typeof furniturePositionSchema>;

export const watermarkSchema = z.strictObject({
  source: z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('text'),
      text: z.string().min(1).max(200),
      style: textStyleSchema,
    }),
    /** A staged image, by the token the main process gave it. */
    z.strictObject({ kind: z.literal('image'), token: z.string().min(1).max(200) }),
  ]),
  opacity: z.number().min(0.05).max(1),
  /** Clockwise, in degrees. */
  rotation: z.number().min(-360).max(360),
  /** Multiplies the size the watermark would otherwise be drawn at. */
  scale: z.number().min(0.05).max(10),
  position: furniturePositionSchema,
  /** True draws it under the page's own content rather than over it. */
  behind: z.boolean(),
});
export type WatermarkSettings = z.infer<typeof watermarkSchema>;

export const backgroundSchema = z.strictObject({
  fill: z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('color'),
      color: z.strictObject({
        r: z.number().min(0).max(1),
        g: z.number().min(0).max(1),
        b: z.number().min(0).max(1),
      }),
    }),
    z.strictObject({
      kind: z.literal('image'),
      token: z.string().min(1).max(200),
      /** Fill covers the page, fit shows all of the image, tile repeats it. */
      fit: z.enum(['fill', 'fit', 'tile']),
    }),
  ]),
  opacity: z.number().min(0.05).max(1),
});
export type BackgroundSettings = z.infer<typeof backgroundSchema>;

/** What goes at the left, the middle and the right of a header or footer. */
export const furnitureLineSchema = z.strictObject({
  left: z.string().max(200),
  center: z.string().max(200),
  right: z.string().max(200),
});
export type FurnitureLine = z.infer<typeof furnitureLineSchema>;

/** The Bates number a page gets, where the pages are numbered in order. */
export const batesSchema = z.strictObject({
  prefix: z.string().max(40),
  suffix: z.string().max(40),
  /** How many digits the number is padded to. */
  digits: z.number().int().min(1).max(12),
  start: z.number().int().min(0).max(1_000_000_000),
});
export type BatesSettings = z.infer<typeof batesSchema>;

export const headerFooterSchema = z.strictObject({
  header: furnitureLineSchema,
  footer: furnitureLineSchema,
  style: textStyleSchema,
  /** How far from the edge of the page the text sits, in points. */
  margin: z.number().min(0).max(300),
  /** The number the first page in the range is given by `{{page}}`. */
  startNumber: z.number().int().min(0).max(1_000_000),
  bates: batesSchema.nullable(),
  /** Resolved by the window, so the engine stays free of locales. */
  date: z.string().max(60),
  title: z.string().max(200),
});
export type HeaderFooterSettings = z.infer<typeof headerFooterSchema>;

/** The tokens a header, footer or watermark may carry. */
export const FURNITURE_TOKENS = ['{{page}}', '{{pages}}', '{{date}}', '{{title}}', '{{bates}}'];
