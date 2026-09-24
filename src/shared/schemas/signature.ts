import { z } from 'zod';

/**
 * Simple signatures: a drawn, typed or imported mark.
 *
 * A signature in PaperForge is a picture placed on the page, not a
 * cryptographic signature. Nothing here validates identity, and no part of
 * the interface may suggest that it does.
 */

export const signatureKindSchema = z.enum(['signature', 'initials']);
export type SignatureKind = z.infer<typeof signatureKindSchema>;

/** A signature the reader asked PaperForge to keep on this computer. */
export const savedSignatureSchema = z.strictObject({
  id: z.string().min(1).max(64),
  kind: signatureKindSchema,
  /** What the reader called it, or the words it draws. */
  name: z.string().min(1).max(120),
  /** Pixels of the picture, for placing it at the right shape. */
  width: z.number().int().min(1).max(20_000),
  height: z.number().int().min(1).max(20_000),
  /** The picture itself, as a data URL, so it can be shown in the list. */
  dataUrl: z.string().max(4_000_000),
  savedAt: z.string(),
});
export type SavedSignature = z.infer<typeof savedSignatureSchema>;

/** A signature about to be placed, and whether to keep it for next time. */
export const stageSignatureSchema = z.strictObject({
  sessionId: z.string().min(1),
  kind: signatureKindSchema,
  name: z.string().min(1).max(120),
  /** PNG bytes, base64-encoded. Pictures cross IPC no other way. */
  data: z.string().min(1).max(4_000_000),
  width: z.number().int().min(1).max(20_000),
  height: z.number().int().min(1).max(20_000),
  /** True keeps it on this computer for next time; false places it once. */
  remember: z.boolean(),
});
export type StageSignatureRequest = z.infer<typeof stageSignatureSchema>;
