import { z } from 'zod';

/**
 * Redaction: taking content off a page for good.
 *
 * A mark is an area of a page the reader wants gone. Marks are pending until
 * they are applied; applying one removes the text, pictures and comments
 * underneath it from the document itself — not just from view — and paints a
 * box where they were (CLAUDE.md section 21).
 */

const coordinate = z.number().finite().min(-1_000_000).max(1_000_000);

/** A rectangle in PDF user space: origin bottom-left, y growing upwards. */
export const redactionRectSchema = z.strictObject({
  x: coordinate,
  y: coordinate,
  width: z.number().finite().min(0.01).max(1_000_000),
  height: z.number().finite().min(0.01).max(1_000_000),
});
export type RedactionRect = z.infer<typeof redactionRectSchema>;

/** How a mark was made, which is also how it is described in the list. */
export const redactionSourceSchema = z.enum(['text', 'area', 'search']);
export type RedactionSource = z.infer<typeof redactionSourceSchema>;

export const redactionMarkSchema = z.strictObject({
  id: z.string().min(1).max(64),
  page: z.number().int().min(1).max(100_000),
  rects: z.array(redactionRectSchema).min(1).max(500),
  /** Why it is being removed, e.g. a statute or "Personal data". */
  reason: z.string().max(120).nullable(),
});
export type RedactionMark = z.infer<typeof redactionMarkSchema>;

const colorSchema = z.strictObject({
  r: z.number().min(0).max(1),
  g: z.number().min(0).max(1),
  b: z.number().min(0).max(1),
});

/** What is painted where the content was. */
export const redactionAppearanceSchema = z.strictObject({
  fill: colorSchema,
  /** Writes the reason on the box, where there is room for it. */
  showReason: z.boolean(),
});
export type RedactionAppearance = z.infer<typeof redactionAppearanceSchema>;

export const DEFAULT_REDACTION_APPEARANCE: RedactionAppearance = {
  fill: { r: 0, g: 0, b: 0 },
  showReason: false,
};

/**
 * A page the window has drawn as a picture, with the marked areas already
 * painted over, to stand in for a page whose content cannot be cut safely.
 */
export const rasterPageSchema = z.strictObject({
  page: z.number().int().min(1).max(100_000),
  /** A staged picture, by token. */
  token: z.string().min(1).max(200),
  /** The part of the page the picture covers, [x1, y1, x2, y2] in user space. */
  viewBox: z.tuple([coordinate, coordinate, coordinate, coordinate]),
});
export type RasterPage = z.infer<typeof rasterPageSchema>;

/** How a page's marks will be applied. */
export const redactionModeSchema = z.enum(['native', 'raster']);
export type RedactionMode = z.infer<typeof redactionModeSchema>;

export const redactionPagePlanSchema = z.strictObject({
  page: z.number().int().min(1),
  mode: redactionModeSchema,
  /** Why the page has to become a picture, in plain words. Empty when native. */
  reasons: z.array(z.string().max(300)).max(20),
});
export type RedactionPagePlan = z.infer<typeof redactionPagePlanSchema>;

/** What applying one mark will take away. */
export const redactionMarkPlanSchema = z.strictObject({
  id: z.string().min(1).max(64),
  /** The text under the mark, as far as the fonts let it be read. */
  text: z.string().max(4000),
  images: z.number().int().nonnegative(),
  annotations: z.number().int().nonnegative(),
});
export type RedactionMarkPlan = z.infer<typeof redactionMarkPlanSchema>;

export const redactionPlanSchema = z.strictObject({
  /** The revision the plan was read from; a different one needs a new plan. */
  revision: z.number().int().nonnegative(),
  pages: z.array(redactionPagePlanSchema),
  marks: z.array(redactionMarkPlanSchema),
  /** Things redaction by area does not reach, stated so the reader can act. */
  notes: z.array(z.string().max(400)).max(20),
});
export type RedactionPlan = z.infer<typeof redactionPlanSchema>;

export const redactionSearchSchema = z.strictObject({
  query: z.string().min(1).max(500),
  matchCase: z.boolean(),
  wholeWord: z.boolean(),
});
export type RedactionSearch = z.infer<typeof redactionSearchSchema>;

export const redactionMatchSchema = z.strictObject({
  page: z.number().int().min(1),
  rects: z.array(redactionRectSchema).min(1).max(500),
  text: z.string().max(4000),
});
export type RedactionMatch = z.infer<typeof redactionMatchSchema>;

export const redactionSearchResultSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  matches: z.array(redactionMatchSchema),
  /** Pages with text whose characters the fonts do not name. */
  unreadablePages: z.array(z.number().int().min(1)),
  /** Pages that draw no text at all, which is what a scan looks like. */
  textlessPages: z.array(z.number().int().min(1)),
});
export type RedactionSearchResult = z.infer<typeof redactionSearchResultSchema>;

/** Most matches a single search will mark, so one search is one reviewable list. */
export const MAX_REDACTION_MATCHES = 2000;
