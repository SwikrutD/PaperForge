import { z } from 'zod';

/**
 * The text a page draws, as the editor sees it.
 *
 * A run is one piece of text the page shows in one go: what it says, the box
 * it occupies in PDF user space, what drew it, and whether PaperForge can
 * write it back. Everything here is read from the document itself.
 */

const measurement = z.number().finite().min(-1_000_000).max(1_000_000);

export const textColorSchema = z.strictObject({
  r: z.number().min(0).max(1),
  g: z.number().min(0).max(1),
  b: z.number().min(0).max(1),
});
export type TextColor = z.infer<typeof textColorSchema>;

export const textRunModelSchema = z.strictObject({
  /** Names the run within its page, for as long as this revision stands. */
  id: z.string().min(1).max(64),
  text: z.string(),
  /** The box the run occupies, in PDF user space. */
  x: measurement,
  y: measurement,
  width: z.number().finite().min(0).max(1_000_000),
  height: z.number().finite().min(0).max(1_000_000),
  /** Where the baseline starts, which is where a caret belongs. */
  baselineX: measurement,
  baselineY: measurement,
  /** How far the text is turned, in degrees clockwise. */
  rotation: z.number().finite(),
  fontName: z.string().max(100),
  /** `/BaseFont`, as the file names it. */
  baseFont: z.string().max(200),
  fontSize: z.number().finite().min(0).max(10_000),
  color: textColorSchema,
  /** Drawn in a mode that shows nothing: an OCR layer, or hidden text. */
  invisible: z.boolean(),
  /** True when the text can be rewritten in the font that drew it. */
  editable: z.boolean(),
  /** Why it cannot be, in words for the reader. */
  reason: z.string().max(300).nullable(),
  /** True when PaperForge drew this text itself, in a font it substituted. */
  replaced: z.boolean(),
});
export type TextRunModel = z.infer<typeof textRunModelSchema>;

/** A font PaperForge can draw with: the families every reader already has. */
export const textFamilySchema = z.enum(['helvetica', 'times', 'courier']);
export type TextFamily = z.infer<typeof textFamilySchema>;

/** How PaperForge draws text it writes itself. */
export const textStyleSchema = z.strictObject({
  family: textFamilySchema,
  bold: z.boolean(),
  italic: z.boolean(),
  size: z.number().finite().min(1).max(1000),
  color: textColorSchema,
});
export type TextStyle = z.infer<typeof textStyleSchema>;

export const DEFAULT_TEXT_STYLE: TextStyle = {
  family: 'helvetica',
  bold: false,
  italic: false,
  size: 12,
  color: { r: 0, g: 0, b: 0 },
};

export const pageTextModelSchema = z.strictObject({
  page: z.number().int().min(1),
  /** The revision the model was read from, so a stale one can be spotted. */
  revision: z.number().int().min(0),
  runs: z.array(textRunModelSchema),
});
export type PageTextModel = z.infer<typeof pageTextModelSchema>;
