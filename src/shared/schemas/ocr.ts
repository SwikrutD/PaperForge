import { z } from 'zod';

/**
 * Recognising the text in a scan, entirely on this computer.
 *
 * PaperForge runs the local Tesseract binary against local language data.
 * Nothing is uploaded, nothing is downloaded, and a document that has been
 * recognised keeps exactly the picture it arrived with — the words go on as
 * an invisible layer over it.
 */

/** Where PaperForge found Tesseract, and what it can do with it. */
export const ocrStatusSchema = z.strictObject({
  available: z.boolean(),
  path: z.string().nullable(),
  version: z.string().nullable(),
  /** The folder the language data was found in, when one is known. */
  tessdataPath: z.string().nullable(),
  /** The languages installed there, by their Tesseract codes. */
  languages: z.array(z.string().max(32)),
  /** Why it cannot be used, in words for the reader. */
  problem: z.string().nullable(),
});
export type OcrStatus = z.infer<typeof ocrStatusSchema>;

/** The resolutions worth rendering a page at before recognising it. */
export const OCR_DPI_CHOICES = [150, 200, 300, 400, 600] as const;

export const ocrOptionsSchema = z.strictObject({
  /** Tesseract language codes, in the order Tesseract should try them. */
  languages: z.array(z.string().min(1).max(32)).min(1).max(8),
  /** How finely the page is rendered before it is read. */
  dpi: z.number().int().min(72).max(1200),
  /**
   * Greys the picture and lifts its contrast before reading it, which helps a
   * photographed page and rarely harms a clean scan.
   */
  preprocess: z.boolean(),
});
export type OcrOptions = z.infer<typeof ocrOptionsSchema>;

export const DEFAULT_OCR_OPTIONS: OcrOptions = {
  languages: ['eng'],
  dpi: 300,
  preprocess: false,
};

/** One word Tesseract read, with the box it read it from, in pixels. */
export const ocrWordSchema = z.strictObject({
  text: z.string().min(1).max(200),
  left: z.number().int().min(0).max(1_000_000),
  top: z.number().int().min(0).max(1_000_000),
  width: z.number().int().min(0).max(1_000_000),
  height: z.number().int().min(0).max(1_000_000),
  /** How sure Tesseract is, from 0 to 100. */
  confidence: z.number().min(-1).max(100),
  /** Which line of the page it belongs to, for keeping reading order. */
  line: z.number().int().min(0),
});
export type OcrWord = z.infer<typeof ocrWordSchema>;

/** What recognising one page came to. */
export const ocrPageResultSchema = z.strictObject({
  page: z.number().int().min(1),
  words: z.array(ocrWordSchema),
  /** The words joined, line by line, for the text output. */
  text: z.string(),
  /** The size of the picture that was read, in pixels. */
  imageWidth: z.number().int().min(1),
  imageHeight: z.number().int().min(1),
  /** The average confidence of the words, or null when nothing was read. */
  confidence: z.number().min(0).max(100).nullable(),
});
export type OcrPageResult = z.infer<typeof ocrPageResultSchema>;
