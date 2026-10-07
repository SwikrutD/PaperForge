import { z } from 'zod';
import { imageCropSchema, imagePlacementSchema } from './edit';

/**
 * The images a page draws, as the editor sees them.
 *
 * Everything here is read from the document: the box the image occupies, how
 * far it is turned, how many pixels it holds, and whether PaperForge put it
 * there itself.
 */

/**
 * Why a picture on the page is not offered for editing: it is inside a form
 * that cannot be read, inside forms nested too deep to follow, or part of an
 * annotation's appearance (a stamp, say), which the comment tools change.
 */
export const skippedImageReasonSchema = z.enum(['form-unreadable', 'form-too-deep', 'annotation']);
export type SkippedImageReason = z.infer<typeof skippedImageReasonSchema>;

export const pageImageSchema = z.strictObject({
  /** Names the image within its page, for as long as this revision stands. */
  id: z.string().min(1).max(64),
  /** The resource name the page calls it by, without its slash. */
  resourceName: z.string().min(1).max(200),
  /** Where it sits, in PDF user space. */
  placement: imagePlacementSchema,
  /** Pixels across and down, as the image itself states them. */
  pixelWidth: z.number().int().min(0),
  pixelHeight: z.number().int().min(0),
  /** The part of the image that shows, when the page crops it. */
  crop: imageCropSchema.nullable(),
  /** How see-through the page draws it, where 1 is solid. */
  opacity: z.number().min(0).max(1),
  /** True when the image carries its own transparency. */
  hasAlpha: z.boolean(),
  /** True when PaperForge added this image rather than the document. */
  added: z.boolean(),
  /**
   * Where the picture is drawn from: the page's own content, a form XObject
   * the page draws, or samples written into the content stream itself.
   */
  source: z.enum(['page', 'form', 'inline']),
  /**
   * How many times the form it is drawn from is drawn in the document — the
   * most of any form on the way down. Above 1, a change asks whether it is for
   * this drawing only or for all of them.
   */
  formUses: z.number().int().min(1),
});
export type PageImageModel = z.infer<typeof pageImageSchema>;

export const pageImageModelSchema = z.strictObject({
  page: z.number().int().min(1),
  /** The revision the model was read from, so a stale one can be spotted. */
  revision: z.number().int().min(0),
  images: z.array(pageImageSchema),
  /** Pictures the page shows that are not offered for editing, and why. */
  skipped: z.array(skippedImageReasonSchema),
});
export type PageImagesModel = z.infer<typeof pageImageModelSchema>;
