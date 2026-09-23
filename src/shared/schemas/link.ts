import { z } from 'zod';

/**
 * The links a page carries.
 *
 * A link is a rectangle with somewhere to go: another page of this document,
 * or an address outside it. PaperForge writes only those two, and describes
 * anything else it finds — a named destination, a launch action, embedded
 * JavaScript — without following or rewriting it.
 */

/** The schemes PaperForge is willing to write into a document. */
const ALLOWED_SCHEMES = ['http:', 'https:', 'mailto:'];

export const linkUrlSchema = z
  .string()
  .min(1)
  .max(2000)
  .refine((value) => {
    try {
      return ALLOWED_SCHEMES.includes(new URL(value).protocol);
    } catch {
      return false;
    }
  }, 'A web address must start with http://, https:// or mailto:');

export const linkTargetSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('page'), page: z.number().int().min(1).max(100_000) }),
  z.strictObject({ kind: z.literal('url'), url: linkUrlSchema }),
  /** Something PaperForge can describe but will not rewrite. */
  z.strictObject({ kind: z.literal('other'), description: z.string().max(300) }),
]);
export type LinkTarget = z.infer<typeof linkTargetSchema>;

export const linkRectSchema = z.strictObject({
  x: z.number().finite().min(-1_000_000).max(1_000_000),
  y: z.number().finite().min(-1_000_000).max(1_000_000),
  width: z.number().finite().min(1).max(1_000_000),
  height: z.number().finite().min(1).max(1_000_000),
});
export type LinkRect = z.infer<typeof linkRectSchema>;

export const linkModelSchema = z.strictObject({
  /** Names the link within the document, for as long as it is there. */
  id: z.string().min(1).max(120),
  rect: linkRectSchema,
  target: linkTargetSchema,
  /** True when PaperForge made this link rather than the document. */
  added: z.boolean(),
});
export type LinkModel = z.infer<typeof linkModelSchema>;

export const pageLinksModelSchema = z.strictObject({
  page: z.number().int().min(1),
  /** The revision the links were read from, so a stale list can be spotted. */
  revision: z.number().int().min(0),
  links: z.array(linkModelSchema),
});
export type PageLinksModel = z.infer<typeof pageLinksModelSchema>;
