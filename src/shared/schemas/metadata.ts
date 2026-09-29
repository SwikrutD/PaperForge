import { z } from 'zod';
import { securitySummarySchema } from './protect';

/**
 * Document properties: the metadata a PDF carries about itself, and the facts
 * about the file that go with it.
 *
 * Editable fields are separated from read-only ones deliberately. A reader can
 * change a title; nothing they type changes how many pages the document has.
 */

const fieldSchema = z.string().max(2000).nullable();

/** The standard entries of the document information dictionary. */
export const documentMetadataSchema = z.strictObject({
  title: fieldSchema,
  author: fieldSchema,
  subject: fieldSchema,
  keywords: fieldSchema,
  creator: fieldSchema,
  producer: fieldSchema,
  /** ISO 8601; null when the document states no date, or an unreadable one. */
  createdAt: fieldSchema,
  modifiedAt: fieldSchema,
});
export type DocumentMetadata = z.infer<typeof documentMetadataSchema>;

export const EMPTY_METADATA: DocumentMetadata = {
  title: null,
  author: null,
  subject: null,
  keywords: null,
  creator: null,
  producer: null,
  createdAt: null,
  modifiedAt: null,
};

/** An entry of the information dictionary that is not one of the standard ones. */
export const customMetadataEntrySchema = z.strictObject({
  name: z.string().min(1).max(200),
  value: z.string().max(2000),
});
export type CustomMetadataEntry = z.infer<typeof customMetadataEntrySchema>;

/** One font the document uses, as its font dictionary describes it. */
export const documentFontSchema = z.strictObject({
  name: z.string().min(1).max(300),
  type: z.string().max(100),
  /** True when the font programme travels with the document. */
  embedded: z.boolean(),
  /** True when only the glyphs the document uses were embedded. */
  subset: z.boolean(),
  encoding: z.string().max(100).nullable(),
});
export type DocumentFont = z.infer<typeof documentFontSchema>;

/** A page size, and how many pages have it. */
export const pageSizeSummarySchema = z.strictObject({
  /** In PDF points, rounded to one decimal, with rotation applied. */
  width: z.number().positive(),
  height: z.number().positive(),
  pageCount: z.number().int().positive(),
});
export type PageSizeSummary = z.infer<typeof pageSizeSummarySchema>;

/**
 * What the document says about itself, as the write engine reads it.
 * Everything outside `metadata` comes from the structure and cannot be typed
 * over. Security is kept apart because it is read from the raw bytes, which is
 * the only way to describe a document nothing can open.
 */
export const documentContentPropertiesSchema = z.strictObject({
  metadata: documentMetadataSchema,
  custom: z.array(customMetadataEntrySchema).max(500),
  pageCount: z.number().int().nonnegative(),
  pageSizes: z.array(pageSizeSummarySchema).max(200),
  fonts: z.array(documentFontSchema).max(500),
  /** True when the document carries an XMP metadata stream as well. */
  hasXmpMetadata: z.boolean(),
  /** True when the catalogue declares a structure tree. */
  tagged: z.boolean(),
  /** The document's language, when it declares one. */
  language: z.string().max(100).nullable(),
  /** True when the file is laid out for fast web view. */
  linearized: z.boolean(),
});
export type DocumentContentProperties = z.infer<typeof documentContentPropertiesSchema>;

/** The content properties together with what the file's bytes say about security. */
export const documentPropertiesSchema = documentContentPropertiesSchema.extend({
  security: securitySummarySchema,
});
export type DocumentProperties = z.infer<typeof documentPropertiesSchema>;

/** What is knowable about a document the write engine cannot open at all. */
export const UNREADABLE_CONTENT: DocumentContentProperties = {
  metadata: EMPTY_METADATA,
  custom: [],
  pageCount: 0,
  pageSizes: [],
  fonts: [],
  hasXmpMetadata: false,
  tagged: false,
  language: null,
  linearized: false,
};
