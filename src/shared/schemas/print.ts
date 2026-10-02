import { z } from 'zod';

/**
 * Printing a document.
 *
 * The window draws each page as a picture and the main process lays the
 * pictures out on sheets for Chromium's printing, which hands them to the
 * Windows printer. Everything a sheet needs — scaling, centring, turning a
 * page to suit the paper — is decided by the sheet itself, so a different
 * paper size or orientation chosen in the Windows print dialog still comes
 * out right.
 */

/** How a page is sized on the sheet. */
export const printScaleSchema = z.enum([
  /** As large as the printable sheet allows, keeping its proportions. */
  'fit',
  /** At the page's own physical size; a page larger than the paper is cut off. */
  'actual',
  /** A percentage of the page's own size. */
  'custom',
]);
export type PrintScale = z.infer<typeof printScaleSchema>;

export const printOrientationSchema = z.enum(['auto', 'portrait', 'landscape']);
export type PrintOrientation = z.infer<typeof printOrientationSchema>;

/** Which of the chosen pages go to the printer. */
export const printSubsetSchema = z.enum(['all', 'odd', 'even']);
export type PrintSubset = z.infer<typeof printSubsetSchema>;

/** How finely a page is drawn for the printer, in dots per inch. */
export const PRINT_QUALITY_DPI = { standard: 150, high: 300 } as const;
export const printQualitySchema = z.enum(['standard', 'high']);
export type PrintQuality = z.infer<typeof printQualitySchema>;

export const printSettingsSchema = z.strictObject({
  /** The Windows printer, by its system name; null is the default printer. */
  deviceName: z.string().min(1).max(512).nullable(),
  /**
   * Shows the Windows print dialog before printing, where the printer, the
   * paper and the driver's own settings can be changed.
   */
  useSystemDialog: z.boolean(),
  copies: z.number().int().min(1).max(999),
  collate: z.boolean(),
  orientation: printOrientationSchema,
  scale: printScaleSchema,
  /** The percentage used when `scale` is custom. */
  customScale: z.number().int().min(10).max(400),
  /** Turns a page whose shape does not match the sheet's so it fills it. */
  autoRotate: z.boolean(),
  /** Centres each page on its sheet; otherwise it sits at the top left. */
  center: z.boolean(),
  /** Prints comments, stamps and form fields as well as the page itself. */
  annotations: z.boolean(),
  /** False prints in shades of grey. */
  color: z.boolean(),
  quality: printQualitySchema,
});
export type PrintSettings = z.infer<typeof printSettingsSchema>;

export const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  deviceName: null,
  useSystemDialog: false,
  copies: 1,
  collate: true,
  orientation: 'auto',
  scale: 'fit',
  customScale: 100,
  autoRotate: true,
  center: true,
  annotations: true,
  color: true,
  quality: 'standard',
};

/** A printer Windows knows about. */
export const printerSchema = z.strictObject({
  name: z.string().max(512),
  displayName: z.string().max(512),
  description: z.string().max(1024),
  isDefault: z.boolean(),
});
export type Printer = z.infer<typeof printerSchema>;

/** One page of a print job, drawn by the window. */
export const printPagePayloadSchema = z.strictObject({
  printId: z.string().min(1).max(64),
  /** The page's size in points as it is seen, with its own rotation applied. */
  width: z.number().positive().max(200_000),
  height: z.number().positive().max(200_000),
  /** The page as a PNG, base64-encoded. */
  image: z.string().min(1).max(200_000_000),
});
export type PrintPagePayload = z.infer<typeof printPagePayloadSchema>;

export const printOutcomeSchema = z.strictObject({
  /** False when the print dialog was dismissed. */
  printed: z.boolean(),
  sheets: z.number().int().min(0),
});
export type PrintOutcome = z.infer<typeof printOutcomeSchema>;
