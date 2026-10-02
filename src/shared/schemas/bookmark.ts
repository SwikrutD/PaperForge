import { z } from 'zod';

/**
 * Bookmarks — the document outline — as PaperForge reads and edits them.
 *
 * An entry is addressed by its position: "0.2" is the third child of the
 * first top-level entry. A position holds for one revision, so every change
 * restates the title it expects to find there and is refused when the outline
 * has moved underneath it.
 */

export const outlinePathSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^\d+(\.\d+)*$/);

export const bookmarkColorSchema = z.strictObject({
  r: z.number().min(0).max(1),
  g: z.number().min(0).max(1),
  b: z.number().min(0).max(1),
});
export type BookmarkColor = z.infer<typeof bookmarkColorSchema>;

export const bookmarkStyleSchema = z.strictObject({
  bold: z.boolean(),
  italic: z.boolean(),
  /** Null leaves the colour to the reader. */
  color: bookmarkColorSchema.nullable(),
});
export type BookmarkStyle = z.infer<typeof bookmarkStyleSchema>;

/** Where a bookmark PaperForge writes goes: a page, and a place on it. */
export const bookmarkTargetSchema = z.strictObject({
  page: z.number().int().min(1).max(100_000),
  /** Distance from the bottom of the page, in PDF units; null is the top. */
  top: z.number().finite().min(-1_000_000).max(1_000_000).nullable(),
});
export type BookmarkTarget = z.infer<typeof bookmarkTargetSchema>;

/** What an existing entry does, as far as PaperForge is prepared to say. */
export const bookmarkActionSchema = z.enum(['page', 'url', 'other', 'none']);
export type BookmarkAction = z.infer<typeof bookmarkActionSchema>;

export interface BookmarkNode {
  path: string;
  title: string;
  /** The page it goes to, when it goes to one in this document. */
  page: number | null;
  action: BookmarkAction;
  style: BookmarkStyle;
  /** True when the document opens this entry to show its children. */
  open: boolean;
  children: BookmarkNode[];
}

export const bookmarkNodeSchema: z.ZodType<BookmarkNode> = z.lazy(() =>
  z.strictObject({
    path: outlinePathSchema,
    title: z.string().max(2000),
    page: z.number().int().min(1).nullable(),
    action: bookmarkActionSchema,
    style: bookmarkStyleSchema,
    open: z.boolean(),
    children: z.array(bookmarkNodeSchema).max(10_000),
  }),
);

export const bookmarkListSchema = z.strictObject({
  revision: z.number().int().min(0),
  /** False for a document the write engine cannot open, such as an encrypted one. */
  editable: z.boolean(),
  bookmarks: z.array(bookmarkNodeSchema).max(10_000),
});
export type BookmarkList = z.infer<typeof bookmarkListSchema>;
