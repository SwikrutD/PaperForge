import { z } from 'zod';

/**
 * Exporting a document to something that is not a PDF.
 *
 * Every mode here is honest about what it can carry: a picture keeps the page
 * exactly as it looks and none of its words; a document export keeps the
 * words and lays them out again as best it can. The names say which is which
 * and the dialog repeats it, because a conversion that quietly loses a table
 * is worse than one that says it might.
 */

export const exportModeSchema = z.enum([
  'png',
  'jpeg',
  'webp',
  'txt',
  'html',
  'docx',
  'xlsx',
  'pptx',
]);
export type ExportMode = z.infer<typeof exportModeSchema>;

/** How a document export lays the words out again. */
export const exportFidelitySchema = z.enum([
  /** Words a reader can edit, laid out again as paragraphs. */
  'editable',
  /** The page as it looks, with the words invisible or absent. */
  'layout',
]);
export type ExportFidelity = z.infer<typeof exportFidelitySchema>;

export const EXPORT_DPI_CHOICES = [72, 96, 150, 300, 600] as const;

export const exportOptionsSchema = z.strictObject({
  mode: exportModeSchema,
  /** Pages to export, in the order they should be written. */
  pages: z.array(z.number().int().min(1).max(100_000)).min(1).max(100_000),
  /** How finely a page is drawn, where a picture is involved. */
  dpi: z.number().int().min(36).max(1200),
  /** JPEG and WebP quality, from 1 to 100. */
  quality: z.number().int().min(1).max(100),
  /** Keeps the page's own transparency, where the format has any. */
  transparent: z.boolean(),
  /** How a document export treats the layout. */
  fidelity: exportFidelitySchema,
  /**
   * What each written file is called. `{name}` is the document's own name,
   * `{page}` the page number and `{n}` a running count.
   */
  naming: z.string().min(1).max(200),
  /** Keeps each line where it sat on the page, rather than as a paragraph. */
  preserveLayout: z.boolean(),
  /** Puts a picture of each page into the HTML, under the page's words. */
  includePageImages: z.boolean(),
});
export type ExportOptions = z.infer<typeof exportOptionsSchema>;

export const DEFAULT_EXPORT_OPTIONS: Omit<ExportOptions, 'pages'> = {
  mode: 'png',
  dpi: 150,
  quality: 90,
  transparent: false,
  fidelity: 'editable',
  naming: '{name} page {page}',
  preserveLayout: false,
  includePageImages: true,
};

/** Whether a local LibreOffice was found, and what it is. */
export const officeStatusSchema = z.strictObject({
  available: z.boolean(),
  path: z.string().nullable(),
  version: z.string().nullable(),
  problem: z.string().nullable(),
});
export type OfficeStatus = z.infer<typeof officeStatusSchema>;

/** One piece of text the page draws, as the window read it. */
export const exportTextItemSchema = z.strictObject({
  text: z.string().max(4000),
  /** In PDF units, from the bottom-left of the page. */
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().min(0),
  height: z.number().finite().min(0),
});
export type ExportTextItem = z.infer<typeof exportTextItemSchema>;

/** Everything one page contributes to an export. */
export const exportPagePayloadSchema = z.strictObject({
  exportId: z.string().min(1).max(64),
  page: z.number().int().min(1).max(100_000),
  /** The page's size in PDF units. */
  width: z.number().finite().min(1),
  height: z.number().finite().min(1),
  items: z.array(exportTextItemSchema).max(100_000),
  /** The page as a picture, base64, when the mode needs one. */
  image: z.string().max(64_000_000).nullable(),
});
export type ExportPagePayload = z.infer<typeof exportPagePayloadSchema>;

/** What a mode needs from the window for each page. */
export function exportNeedsImage(options: {
  mode: ExportMode;
  fidelity: ExportFidelity;
  includePageImages: boolean;
}): boolean {
  if (options.mode === 'png' || options.mode === 'jpeg' || options.mode === 'webp') return true;
  if (options.mode === 'pptx') return options.fidelity === 'layout';
  if (options.mode === 'html') return options.includePageImages;
  return false;
}

/** What a mode needs of the page's words. */
export function exportNeedsText(mode: ExportMode): boolean {
  return mode === 'txt' || mode === 'html' || mode === 'docx' || mode === 'xlsx' || mode === 'pptx';
}

/** What each mode is honest about, shown beside it in the dialog. */
export const EXPORT_DESCRIPTIONS: Record<ExportMode, string> = {
  png: 'A picture of each page. Keeps the page exactly as it looks; carries none of its words.',
  jpeg: 'A picture of each page, smaller and slightly softer than PNG.',
  webp: 'A picture of each page, smaller again. Not every program opens WebP.',
  txt: 'The words, and nothing else: no pictures, no colours, no layout.',
  html: 'The words laid out where they sit on the page, with a picture of each page beneath them.',
  docx: 'The words as paragraphs a word processor can edit. Some complex layouts will change.',
  xlsx: 'Rows and columns where PaperForge can see them. Anything else becomes one row a line.',
  pptx: 'One slide per page: either the page as a picture, or its words as editable text.',
};
