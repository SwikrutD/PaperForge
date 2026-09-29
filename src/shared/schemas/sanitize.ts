import { z } from 'zod';

/**
 * Hidden information: what a document carries besides the pages it shows.
 *
 * PaperForge reports what it finds and removes only what the reader chooses.
 * Nothing found here is ever executed — a launch action or a piece of document
 * JavaScript is described and then deleted, never run (CLAUDE.md section 22).
 */

export const sanitizeCategorySchema = z.enum([
  'metadata',
  'xmpMetadata',
  'attachments',
  'documentJavaScript',
  'launchActions',
  'hiddenAnnotations',
  'formData',
  'thumbnails',
  'hiddenLayers',
  'alternateImages',
]);
export type SanitizeCategory = z.infer<typeof sanitizeCategorySchema>;

/** What each category means, in the words the dialog uses. */
export const SANITIZE_CATEGORY_LABELS: Record<SanitizeCategory, string> = {
  metadata: 'Document metadata',
  xmpMetadata: 'XMP metadata',
  attachments: 'Embedded files',
  documentJavaScript: 'Document JavaScript',
  launchActions: 'Launch and submit actions',
  hiddenAnnotations: 'Hidden comments',
  formData: 'Form field values',
  thumbnails: 'Saved page thumbnails',
  hiddenLayers: 'Hidden layers',
  alternateImages: 'Alternate images',
};

export const SANITIZE_CATEGORY_DESCRIPTIONS: Record<SanitizeCategory, string> = {
  metadata: 'Title, author, keywords, and the program that made the file.',
  xmpMetadata: 'The XML metadata packet, which often repeats the author and dates.',
  attachments: 'Whole files carried inside the document.',
  documentJavaScript: 'Scripts the document asks a reader to run. PaperForge never runs them.',
  launchActions: 'Actions that start a program, open a file, or send form data away.',
  hiddenAnnotations: 'Comments marked not to be shown or not to be printed.',
  formData: 'What the form fields hold. The fields themselves stay.',
  thumbnails: 'Pictures of the pages saved inside the file, which can be out of date.',
  hiddenLayers: 'Optional content that is switched off, and so not on show.',
  alternateImages: 'Second versions of an image a reader may choose instead.',
};

export const sanitizeFindingSchema = z.strictObject({
  category: sanitizeCategorySchema,
  /** How many of the thing were found; zero means the category is clean. */
  count: z.number().int().nonnegative(),
  /** Examples or specifics, e.g. the names of the embedded files. */
  detail: z.string().max(2000),
});
export type SanitizeFinding = z.infer<typeof sanitizeFindingSchema>;

export const sanitizeReportSchema = z.strictObject({
  findings: z.array(sanitizeFindingSchema),
  /**
   * True when the document was saved more than once, so earlier revisions may
   * still be in the file. A full rewrite is what removes them.
   */
  hasIncrementalUpdates: z.boolean(),
});
export type SanitizeReport = z.infer<typeof sanitizeReportSchema>;

/** Categories in the order the report shows them. */
export const SANITIZE_CATEGORIES = sanitizeCategorySchema.options;
