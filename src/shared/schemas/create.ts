import { z } from 'zod';

/**
 * Making a new PDF: the paper it is printed on, the files it is made from, and
 * the ways several documents are put together.
 *
 * Every file a new document is made from is staged in the main process first,
 * so the renderer arranges sources it can name but has never read.
 */

/** A page dimension in PDF points. 1 in = 72 pt; the limit is 200 in. */
const dimension = z.number().finite().min(36).max(14_400);

export const pageOrientationSchema = z.enum(['portrait', 'landscape']);
export type PageOrientation = z.infer<typeof pageOrientationSchema>;

export const paperPresetSchema = z.enum(['a3', 'a4', 'a5', 'letter', 'legal', 'tabloid']);
export type PaperPreset = z.infer<typeof paperPresetSchema>;

/**
 * The size of the pages being made.
 *
 * `image` gives each page the size of the image on it, which is what a reader
 * scanning photographs into a PDF usually wants; it means nothing for text.
 */
export const pageSizeSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('preset'),
    preset: paperPresetSchema,
    orientation: pageOrientationSchema,
  }),
  z.strictObject({ kind: z.literal('custom'), width: dimension, height: dimension }),
  z.strictObject({ kind: z.literal('image') }),
]);
export type PageSize = z.infer<typeof pageSizeSchema>;

/** How a file that is not already a PDF is put onto pages. */
export const pageSetupSchema = z.strictObject({
  size: pageSizeSchema,
  /** Space kept clear around the content, in points. */
  margin: z.number().min(0).max(216),
});
export type PageSetup = z.infer<typeof pageSetupSchema>;

/** What a new document says about itself. The rest is Segment 14's work. */
export const newDocumentMetadataSchema = z.strictObject({
  title: z.string().max(300),
  author: z.string().max(200),
});
export type NewDocumentMetadata = z.infer<typeof newDocumentMetadataSchema>;

export const DEFAULT_PAGE_SETUP: PageSetup = {
  size: { kind: 'preset', preset: 'a4', orientation: 'portrait' },
  margin: 36,
};

/** What a staged file started life as, before it became pages. */
export const sourceKindSchema = z.enum(['pdf', 'image', 'text', 'html']);
export type SourceKind = z.infer<typeof sourceKindSchema>;

/**
 * A file staged for a new document.
 *
 * Anything that was not a PDF has already been made into one, so a source
 * always has a real page count and can be previewed like any other document.
 */
export const stagedSourceSchema = z.strictObject({
  id: z.string().min(1).max(200),
  fileName: z.string().min(1).max(260),
  kind: sourceKindSchema,
  pageCount: z.number().int().min(1).max(100_000),
  sizeBytes: z.number().int().min(0),
});
export type StagedSource = z.infer<typeof stagedSourceSchema>;

/** A file that could not be staged, and why, in words a reader can act on. */
export const sourceFailureSchema = z.strictObject({
  fileName: z.string().min(1).max(260),
  message: z.string().min(1).max(500),
  details: z.string().max(2000).optional(),
});
export type SourceFailure = z.infer<typeof sourceFailureSchema>;

export const stagedSourcesSchema = z.strictObject({
  sources: z.array(stagedSourceSchema),
  failures: z.array(sourceFailureSchema),
  canceled: z.boolean(),
});
export type StagedSources = z.infer<typeof stagedSourcesSchema>;

/** One source, and which of its pages the new document takes. */
export const combineEntrySchema = z.strictObject({
  id: z.string().min(1).max(200),
  /** Null takes every page, in order. */
  pages: z.array(z.number().int().min(1).max(100_000)).min(1).max(100_000).nullable(),
  /** Clockwise rotation added to the pages taken from this source. */
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
});
export type CombineEntry = z.infer<typeof combineEntrySchema>;

export const combineRequestSchema = z.strictObject({
  entries: z.array(combineEntrySchema).min(1).max(1000),
  /** A top-level bookmark naming each file the pages came from. */
  bookmarkPerSource: z.boolean(),
  /** Carry the bookmarks each source already has, where they still point at a page taken. */
  keepBookmarks: z.boolean(),
  metadata: newDocumentMetadataSchema,
});
export type CombineRequest = z.infer<typeof combineRequestSchema>;

export const blankRequestSchema = z.strictObject({
  size: pageSizeSchema,
  pageCount: z.number().int().min(1).max(1000),
  metadata: newDocumentMetadataSchema,
});
export type BlankRequest = z.infer<typeof blankRequestSchema>;

/** What making a document actually produced. */
export const createOutcomeSchema = z.strictObject({
  canceled: z.boolean(),
  /** Absolute path of the file written, or null when nothing was. */
  path: z.string().nullable(),
  pageCount: z.number().int().min(0),
});
export type CreateOutcome = z.infer<typeof createOutcomeSchema>;
