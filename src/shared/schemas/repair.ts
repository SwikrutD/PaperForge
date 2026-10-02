import { z } from 'zod';

/**
 * Checking a document's structure, and writing a repaired copy of it.
 *
 * A repaired copy is always a new file: PaperForge never replaces the file
 * that was opened with its own idea of what it should have been.
 */

/** What qpdf made of the file, when qpdf is installed. */
export const qpdfVerdictSchema = z.enum(['clean', 'warnings', 'unreadable']);
export type QpdfVerdict = z.infer<typeof qpdfVerdictSchema>;

export const repairDiagnosisSchema = z.strictObject({
  qpdf: z.strictObject({
    available: z.boolean(),
    version: z.string().nullable(),
    /** Null when qpdf is not installed or could not be run. */
    verdict: qpdfVerdictSchema.nullable(),
    /** What qpdf said, a line each, without the lines that only repeat the file name. */
    messages: z.array(z.string().max(2000)).max(200),
    /** True when qpdf said more than is listed. */
    truncated: z.boolean(),
  }),
  /** Whether PaperForge's own write engine could read the document. */
  engine: z.strictObject({
    readable: z.boolean(),
    pageCount: z.number().int().min(0),
    problem: z.string().nullable(),
  }),
  /**
   * PaperForge's own reading of the file's index of objects, which needs no
   * sidecar. Null for a file too large to check this way.
   */
  index: z
    .strictObject({
      ok: z.boolean(),
      problems: z.array(z.string().max(500)).max(20),
    })
    .nullable(),
  encrypted: z.boolean(),
  sizeBytes: z.number().int().min(0),
  /** True when a repaired copy can be attempted at all. */
  canRepair: z.boolean(),
});
export type RepairDiagnosis = z.infer<typeof repairDiagnosisSchema>;

/** Which engine wrote the repaired copy. */
export const repairMethodSchema = z.enum(['qpdf', 'rewrite']);
export type RepairMethod = z.infer<typeof repairMethodSchema>;

export const repairOutcomeSchema = z.strictObject({
  canceled: z.boolean(),
  /** Where the repaired copy was written, or null when nothing was. */
  path: z.string().nullable(),
  method: repairMethodSchema.nullable(),
  pageCount: z.number().int().min(0),
  /** What the engine that wrote the copy reported while doing it. */
  messages: z.array(z.string().max(2000)).max(200),
});
export type RepairOutcome = z.infer<typeof repairOutcomeSchema>;
