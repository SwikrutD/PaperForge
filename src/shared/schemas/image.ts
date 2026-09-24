import { z } from 'zod';
import { imageCropSchema, imagePlacementSchema } from './edit';

/**
 * The images a page draws, as the editor sees them.
 *
 * Everything here is read from the document: the box the image occupies, how
 * far it is turned, how many pixels it holds, and whether PaperForge put it
 * there itself.
 */

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
});
export type PageImageModel = z.infer<typeof pageImageSchema>;

export const pageImageModelSchema = z.strictObject({
  page: z.number().int().min(1),
  /** The revision the model was read from, so a stale one can be spotted. */
  revision: z.number().int().min(0),
  images: z.array(pageImageSchema),
});
export type PageImagesModel = z.infer<typeof pageImageModelSchema>;
