import { z } from 'zod';
import { annotationInputSchema, annotationPatchSchema } from './annotation';
import { documentSessionSchema } from './document';

/**
 * The edit vocabulary.
 *
 * An operation describes a change in terms of the document, never in terms of
 * bytes or files, so the renderer can compose one without any filesystem
 * access and the main process can apply it to a working copy it controls.
 */

const pageNumberSchema = z.number().int().min(1).max(100_000);
const pageListSchema = z.array(pageNumberSchema).min(1).max(100_000);

/** Clockwise rotation added to the rotation a page already carries. */
export const rotationDegreesSchema = z.union([z.literal(90), z.literal(180), z.literal(270)]);
export type RotationDegrees = z.infer<typeof rotationDegreesSchema>;

export const rotatePagesOperationSchema = z.strictObject({
  kind: z.literal('rotatePages'),
  pages: pageListSchema,
  degrees: rotationDegreesSchema,
});

export const deletePagesOperationSchema = z.strictObject({
  kind: z.literal('deletePages'),
  pages: pageListSchema,
});

/** Adds annotations, which carry the page they belong to themselves. */
export const addAnnotationsOperationSchema = z.strictObject({
  kind: z.literal('addAnnotations'),
  annotations: z.array(annotationInputSchema).min(1).max(500),
});

export const updateAnnotationsOperationSchema = z.strictObject({
  kind: z.literal('updateAnnotations'),
  updates: z
    .array(z.strictObject({ id: z.string().min(1).max(120), patch: annotationPatchSchema }))
    .min(1)
    .max(500),
});

export const deleteAnnotationsOperationSchema = z.strictObject({
  kind: z.literal('deleteAnnotations'),
  ids: z.array(z.string().min(1).max(120)).min(1).max(500),
});

export const editOperationSchema = z.discriminatedUnion('kind', [
  rotatePagesOperationSchema,
  deletePagesOperationSchema,
  addAnnotationsOperationSchema,
  updateAnnotationsOperationSchema,
  deleteAnnotationsOperationSchema,
]);
export type EditOperation = z.infer<typeof editOperationSchema>;

/**
 * One undoable step. Grouping several operations under one label is how a
 * single reader action that changes more than one thing stays a single undo.
 */
export const editTransactionSchema = z.strictObject({
  /** Shown on the Undo and Redo commands, e.g. "Rotate page 3". */
  label: z.string().min(1).max(120),
  operations: z.array(editOperationSchema).min(1).max(1000),
});
export type EditTransaction = z.infer<typeof editTransactionSchema>;

/** What the renderer needs to know about a document's unsaved state. */
export const documentEditStateSchema = z.strictObject({
  sessionId: z.string().min(1),
  /**
   * Which revision of the document is current. Revision 0 is the file as it
   * was opened; every applied transaction adds one. The viewer reloads when
   * this changes.
   */
  revision: z.number().int().nonnegative(),
  /** True when the current revision differs from what is on disk. */
  dirty: z.boolean(),
  canUndo: z.boolean(),
  canRedo: z.boolean(),
  undoLabel: z.string().nullable(),
  redoLabel: z.string().nullable(),
  /** When this document was last saved in this session, if it was. */
  savedAt: z.string().nullable(),
  /** True when undo history was trimmed to stay within its budget. */
  historyTrimmed: z.boolean(),
});
export type DocumentEditState = z.infer<typeof documentEditStateSchema>;

export const saveModeSchema = z.enum(['save', 'saveAs', 'saveCopy']);
export type SaveMode = z.infer<typeof saveModeSchema>;

export const saveOutcomeSchema = z.strictObject({
  /** True when the reader dismissed the file dialog. */
  canceled: z.boolean(),
  /** The session after the save; Save As changes the file it points at. */
  session: documentSessionSchema.nullable(),
  edit: documentEditStateSchema.nullable(),
  /** Where the bytes were written. A copy does not change the session. */
  path: z.string().nullable(),
  /** What the qpdf check said, when qpdf is installed. */
  checkedWithQpdf: z.boolean(),
});
export type SaveOutcome = z.infer<typeof saveOutcomeSchema>;

/** Whether the local qpdf sidecar is usable, for Settings and diagnostics. */
export const qpdfStatusSchema = z.strictObject({
  available: z.boolean(),
  path: z.string().nullable(),
  version: z.string().nullable(),
  /** Why it is unusable, in plain language. */
  problem: z.string().nullable(),
});
export type QpdfStatus = z.infer<typeof qpdfStatusSchema>;
