import { z } from 'zod';

/**
 * The Accessibility Check: what can be told about a document's accessibility
 * from its structure, and what cannot.
 *
 * Every check is something PaperForge actually reads out of the file — a
 * title, a language, a tag tree, a figure's alternate text. Checks that need a
 * person (is the reading order sensible? is the contrast enough?) are listed as
 * such rather than passed. Nothing here certifies a document against PDF/UA or
 * any other standard.
 */

export const accessibilityCheckIdSchema = z.enum([
  'title',
  'displayTitle',
  'language',
  'tagged',
  'figureAltText',
  'imageOnlyPages',
  'formFieldNames',
  'linkTargets',
  'linkDescriptions',
  'tabOrder',
  'untaggedContent',
  'assistivePermission',
  'readingOrder',
  'colourContrast',
]);
export type AccessibilityCheckId = z.infer<typeof accessibilityCheckIdSchema>;

/**
 * What a check found. `manual` is a check only a person can make; `notApplicable`
 * is one the document gives nothing to check, such as alternate text in a
 * document without figures.
 */
export const accessibilityStatusSchema = z.enum([
  'passed',
  'failed',
  'warning',
  'manual',
  'notApplicable',
]);
export type AccessibilityStatus = z.infer<typeof accessibilityStatusSchema>;

const rectSchema = z.strictObject({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().min(0),
  height: z.number().finite().min(0),
});
export type AccessibilityRect = z.infer<typeof rectSchema>;

/**
 * Where an element of the tag tree sits, as the indexes of structure elements
 * from the root down — "0.3.1" is the second child of the fourth child of the
 * first. It holds for as long as the tree does, which is one revision.
 */
export const structurePathSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^\d+(\.\d+)*$/);

/** What an item of a check points at, so it can be gone to or fixed. */
export const accessibilityTargetSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('page') }),
  z.strictObject({
    kind: z.literal('figure'),
    path: structurePathSchema,
    /** The element's type after the document's role map, e.g. "Figure". */
    type: z.string().max(100),
    alt: z.string().max(5000).nullable(),
  }),
  z.strictObject({ kind: z.literal('field'), name: z.string().min(1).max(500) }),
  z.strictObject({ kind: z.literal('link') }),
]);
export type AccessibilityTarget = z.infer<typeof accessibilityTargetSchema>;

export const accessibilityItemSchema = z.strictObject({
  /** One-based page, when the item belongs to one. */
  page: z.number().int().min(1).nullable(),
  label: z.string().max(500),
  /** Where on the page, in PDF user space, when that is known. */
  rect: rectSchema.nullable(),
  target: accessibilityTargetSchema,
});
export type AccessibilityItem = z.infer<typeof accessibilityItemSchema>;

export const accessibilityCheckSchema = z.strictObject({
  id: accessibilityCheckIdSchema,
  status: accessibilityStatusSchema,
  /** One sentence on what was found. */
  summary: z.string().max(500),
  items: z.array(accessibilityItemSchema).max(500),
  /** True when more items were found than are listed. */
  truncated: z.boolean(),
});
export type AccessibilityCheck = z.infer<typeof accessibilityCheckSchema>;

export const accessibilityReportSchema = z.strictObject({
  /** The revision the report was made from, so a stale one can be spotted. */
  revision: z.number().int().min(0),
  checks: z.array(accessibilityCheckSchema),
  pageCount: z.number().int().min(0),
  tagged: z.boolean(),
  /** The current title and language, which the checker's fixes start from. */
  title: z.string().max(2000).nullable(),
  language: z.string().max(100).nullable(),
});
export type AccessibilityReport = z.infer<typeof accessibilityReportSchema>;

/** One region of a page in the order the tag tree reads it. */
export const readingOrderRegionSchema = z.strictObject({
  /** Position in the reading order of this page, from 1. */
  order: z.number().int().min(1),
  /** The structure element's type after role mapping, e.g. "P" or "H1". */
  type: z.string().max(100),
  rect: rectSchema,
});
export type ReadingOrderRegion = z.infer<typeof readingOrderRegionSchema>;

export const readingOrderSchema = z.strictObject({
  page: z.number().int().min(1),
  revision: z.number().int().min(0),
  /** False when the document has no tag tree, so there is no order to show. */
  tagged: z.boolean(),
  regions: z.array(readingOrderRegionSchema).max(5000),
  /** Text the page draws that the tag tree does not mention and is not marked as decoration. */
  untagged: z.array(rectSchema).max(5000),
});
export type ReadingOrder = z.infer<typeof readingOrderSchema>;

/**
 * A language tag as BCP 47 spells one: "en", "en-GB", "zh-Hant-TW". The check
 * is on shape only; PaperForge does not carry the registry.
 */
export const languageTagSchema = z
  .string()
  .trim()
  .min(2)
  .max(35)
  .regex(/^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$/, 'A language looks like "en" or "en-GB".');
