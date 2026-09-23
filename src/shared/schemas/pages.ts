import { z } from 'zod';

/**
 * Page-level facts and requests: the boxes a page declares, the labels a
 * document prints on its pages, and the ways pages are taken out of one.
 */

const measurement = z.number().finite().min(-1_000_000).max(1_000_000);

/** A page box in PDF user space, as `[x1, y1, x2, y2]` normalized to a rect. */
export const pageBoxSchema = z.strictObject({
  x: measurement,
  y: measurement,
  width: z.number().finite().min(0).max(1_000_000),
  height: z.number().finite().min(0).max(1_000_000),
});
export type PageBoxRect = z.infer<typeof pageBoxSchema>;

/**
 * Everything a page says about its own geometry.
 *
 * Only the media box is required of a PDF page; the others are optional, and
 * a page that does not declare one is reported as null rather than as a copy
 * of the media box, so the inspector can say which are really there.
 */
export const pageBoxesSchema = z.strictObject({
  pageNumber: z.number().int().min(1),
  rotation: z.number().int(),
  media: pageBoxSchema,
  crop: pageBoxSchema.nullable(),
  bleed: pageBoxSchema.nullable(),
  trim: pageBoxSchema.nullable(),
  art: pageBoxSchema.nullable(),
  /** The label the document prints on this page, when it numbers its own. */
  label: z.string().nullable(),
});
export type PageBoxes = z.infer<typeof pageBoxesSchema>;

/** How a page label counts. */
export const pageLabelStyleSchema = z.enum([
  'decimal',
  'romanLower',
  'romanUpper',
  'letterLower',
  'letterUpper',
  'none',
]);
export type PageLabelStyle = z.infer<typeof pageLabelStyleSchema>;

/** A file staged for use as pages: another PDF, or an image. */
export const pageSourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('pdf'),
    token: z.string().min(1).max(200),
    fileName: z.string().min(1).max(260),
    pageCount: z.number().int().min(1),
  }),
  z.strictObject({
    kind: z.literal('image'),
    token: z.string().min(1).max(200),
    fileName: z.string().min(1).max(260),
    width: z.number().positive(),
    height: z.number().positive(),
  }),
]);
export type PageSource = z.infer<typeof pageSourceSchema>;

/** Where extracted pages go, and whether they stay behind as well. */
export const extractRequestSchema = z.strictObject({
  sessionId: z.string().min(1),
  pages: z.array(z.number().int().min(1)).min(1).max(100_000),
  /** One file with every chosen page, or one file per page. */
  mode: z.enum(['single', 'perPage']),
  /** Remove the pages from the document afterwards. */
  deleteAfter: z.boolean(),
});
export type ExtractRequest = z.infer<typeof extractRequestSchema>;

/** One piece a split produces. */
export const splitPartSchema = z.strictObject({
  /** Suggested file name, without a directory. */
  name: z.string().min(1).max(200),
  pages: z.array(z.number().int().min(1)).min(1).max(100_000),
});
export type SplitPart = z.infer<typeof splitPartSchema>;

export const splitRequestSchema = z.strictObject({
  sessionId: z.string().min(1),
  parts: z.array(splitPartSchema).min(1).max(2000),
});
export type SplitRequest = z.infer<typeof splitRequestSchema>;

/** What writing files out actually produced. */
export const exportResultSchema = z.strictObject({
  canceled: z.boolean(),
  /** Absolute paths of the files written, in the order they were written. */
  paths: z.array(z.string()),
  /** The folder they went to, for "show in Explorer". */
  directory: z.string().nullable(),
});
export type ExportResult = z.infer<typeof exportResultSchema>;
