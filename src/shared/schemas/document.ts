import { z } from 'zod';
import { appErrorCodes } from '../errors/appError';

/**
 * What PaperForge can tell about a file before a PDF engine is involved.
 *
 * Everything here comes from the file itself: the stat record, the header and
 * the trailer. `encryptionDetected` is a trailer scan, not a full parse — the
 * viewer confirms it when it loads the document.
 */
export const documentFileInfoSchema = z.object({
  path: z.string().min(1),
  displayName: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  modifiedAt: z.string().min(1),
  readOnly: z.boolean(),
  /** e.g. "1.7"; null when the header does not state one. */
  pdfVersion: z.string().nullable(),
  encryptionDetected: z.boolean(),
});
export type DocumentFileInfo = z.infer<typeof documentFileInfoSchema>;

/** One open document. A second open of the same file gets its own session. */
export const documentSessionSchema = z.object({
  id: z.string().min(1),
  /** Stable per file path, so restore and recent files can match it. */
  documentId: z.string().min(1),
  file: documentFileInfoSchema,
  openedAt: z.string().min(1),
  /** True once the document has unsaved changes. Editing lands in Segment 5. */
  dirty: z.boolean(),
});
export type DocumentSession = z.infer<typeof documentSessionSchema>;

export const openFailureSchema = z.object({
  path: z.string().min(1),
  code: z.enum(appErrorCodes),
  message: z.string().min(1),
  details: z.string().optional(),
});
export type OpenFailure = z.infer<typeof openFailureSchema>;

export const openResultSchema = z.object({
  sessions: z.array(documentSessionSchema),
  failures: z.array(openFailureSchema),
  /** True when the user dismissed the file picker. */
  canceled: z.boolean(),
});
export type OpenResult = z.infer<typeof openResultSchema>;

export const fileChangeKindSchema = z.enum(['modified', 'deleted']);
export type FileChangeKind = z.infer<typeof fileChangeKindSchema>;

/** Pushed when a file changes underneath an open session. */
export const fileChangeEventSchema = z.object({
  sessionId: z.string().min(1),
  change: fileChangeKindSchema,
  file: documentFileInfoSchema.nullable(),
});
export type FileChangeEvent = z.infer<typeof fileChangeEventSchema>;

/** A document session left behind by a crash. */
export const recoveryEntrySchema = z.object({
  sessionId: z.string().min(1),
  path: z.string().min(1),
  displayName: z.string().min(1),
  openedAt: z.string().min(1),
  lastTouchedAt: z.string().min(1),
  dirty: z.boolean(),
  /** True when the changes themselves were kept and can be reopened. */
  unsavedChanges: z.boolean(),
  /** False when the original file is no longer where it was. */
  fileStillExists: z.boolean(),
});
export type RecoveryEntry = z.infer<typeof recoveryEntrySchema>;
