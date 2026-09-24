import { z } from 'zod';
import { linkRectSchema, linkTargetSchema } from './link';
import { formValueChangeSchema } from './form';
import {
  backgroundSchema,
  furnitureKindSchema,
  headerFooterSchema,
  watermarkSchema,
} from './furniture';
import { annotationInputSchema, annotationPatchSchema } from './annotation';
import { pageBoxSchema, pageLabelStyleSchema } from './pages';
import { textStyleSchema } from './text';
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

/** Moves pages to a new position, keeping their order among themselves. */
export const movePagesOperationSchema = z.strictObject({
  kind: z.literal('movePages'),
  pages: pageListSchema,
  /** Where the block lands, counted in pages before the move. */
  toIndex: z.number().int().min(0).max(100_000),
});

export const duplicatePagesOperationSchema = z.strictObject({
  kind: z.literal('duplicatePages'),
  pages: pageListSchema,
});

export const insertBlankPagesOperationSchema = z.strictObject({
  kind: z.literal('insertBlankPages'),
  atIndex: z.number().int().min(0).max(100_000),
  count: z.number().int().min(1).max(500),
  /** Null takes the size of the page the new ones follow. */
  size: z.strictObject({ width: z.number().positive(), height: z.number().positive() }).nullable(),
});

/** Inserts pages from another document, staged by the main process. */
export const insertPagesOperationSchema = z.strictObject({
  kind: z.literal('insertPages'),
  atIndex: z.number().int().min(0).max(100_000),
  token: z.string().min(1).max(200),
  /** Which pages of the source; null takes all of them. */
  pages: pageListSchema.nullable(),
});

export const insertImagePagesOperationSchema = z.strictObject({
  kind: z.literal('insertImagePages'),
  atIndex: z.number().int().min(0).max(100_000),
  token: z.string().min(1).max(200),
  /** Null makes the page the size of the image itself. */
  size: z.strictObject({ width: z.number().positive(), height: z.number().positive() }).nullable(),
  margin: z.number().min(0).max(300),
});

export const cropPagesOperationSchema = z.strictObject({
  kind: z.literal('cropPages'),
  pages: pageListSchema,
  box: pageBoxSchema,
  /**
   * The crop box hides what is outside it and can be undone; the media box is
   * the page itself, which is why changing it is a separate choice.
   */
  target: z.enum(['crop', 'media']),
});

export const setPageLabelsOperationSchema = z.strictObject({
  kind: z.literal('setPageLabels'),
  fromPage: z.number().int().min(1).max(100_000),
  style: pageLabelStyleSchema,
  prefix: z.string().max(60),
  start: z.number().int().min(1).max(100_000),
});

/**
 * Rewrites one run of text a page draws.
 *
 * The run is named by the operation it came from, which holds for as long as
 * the content does — every change makes a new revision, and the runs are read
 * again from it.
 */
export const editTextOperationSchema = z.strictObject({
  kind: z.literal('editText'),
  page: z.number().int().min(1).max(100_000),
  runId: z.string().min(1).max(64),
  text: z.string().max(4000),
});

/**
 * Takes a run of text out and draws it again in a font PaperForge controls.
 *
 * This is what happens when the font that drew the text cannot write what the
 * reader typed. The original glyphs are removed and the advance kept, so the
 * rest of the line stays where it was.
 */
export const replaceTextOperationSchema = z.strictObject({
  kind: z.literal('replaceText'),
  page: z.number().int().min(1).max(100_000),
  runId: z.string().min(1).max(64),
  text: z.string().max(4000),
  /** Null keeps the look of the text being replaced, as closely as it can. */
  style: textStyleSchema.nullable(),
});

/** Draws new text on a page, where there was none. */
export const addTextOperationSchema = z.strictObject({
  kind: z.literal('addText'),
  page: z.number().int().min(1).max(100_000),
  /** Where the baseline starts, in PDF user space. */
  x: z.number().finite().min(-1_000_000).max(1_000_000),
  y: z.number().finite().min(-1_000_000).max(1_000_000),
  text: z.string().min(1).max(4000),
  style: textStyleSchema,
});

const coordinate = z.number().finite().min(-1_000_000).max(1_000_000);

/** Where an image sits on the page, as the reader sees it. */
export const imagePlacementSchema = z.strictObject({
  x: coordinate,
  y: coordinate,
  width: z.number().finite().min(1).max(1_000_000),
  height: z.number().finite().min(1).max(1_000_000),
  /** Clockwise, in degrees. */
  rotation: z.number().finite().min(-360).max(360),
  flipX: z.boolean(),
  flipY: z.boolean(),
});
export type ImagePlacementInput = z.infer<typeof imagePlacementSchema>;

/** The part of an image to show, where the whole image is the unit square. */
export const imageCropSchema = z.strictObject({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0.001).max(1),
  height: z.number().min(0.001).max(1),
});

/** Moves, resizes, turns, crops or replaces an image the page already draws. */
export const placeImageOperationSchema = z.strictObject({
  kind: z.literal('placeImage'),
  page: z.number().int().min(1).max(100_000),
  imageId: z.string().min(1).max(64),
  placement: imagePlacementSchema,
  crop: imageCropSchema.nullable(),
  /** How see-through to draw it, where 1 is solid. */
  opacity: z.number().min(0.05).max(1),
  /** A staged image to draw in its place, or null to keep the one there. */
  token: z.string().min(1).max(200).nullable(),
});

export const deleteImageOperationSchema = z.strictObject({
  kind: z.literal('deleteImage'),
  page: z.number().int().min(1).max(100_000),
  imageId: z.string().min(1).max(64),
});

/** Draws a staged image on a page, over what is already there. */
export const addImageOperationSchema = z.strictObject({
  kind: z.literal('addImage'),
  page: z.number().int().min(1).max(100_000),
  token: z.string().min(1).max(200),
  placement: imagePlacementSchema,
  opacity: z.number().min(0.05).max(1),
});

/** Adds a link over part of a page. */
export const addLinkOperationSchema = z.strictObject({
  kind: z.literal('addLink'),
  page: z.number().int().min(1).max(100_000),
  rect: linkRectSchema,
  target: linkTargetSchema,
});

/** Moves a link, or points it somewhere else. */
export const updateLinkOperationSchema = z.strictObject({
  kind: z.literal('updateLink'),
  page: z.number().int().min(1).max(100_000),
  linkId: z.string().min(1).max(120),
  rect: linkRectSchema.nullable(),
  target: linkTargetSchema.nullable(),
});

export const deleteLinkOperationSchema = z.strictObject({
  kind: z.literal('deleteLink'),
  page: z.number().int().min(1).max(100_000),
  linkId: z.string().min(1).max(120),
});

/** Puts a watermark on the chosen pages, in place of any PaperForge wrote. */
export const setWatermarkOperationSchema = z.strictObject({
  kind: z.literal('setWatermark'),
  pages: pageListSchema,
  watermark: watermarkSchema,
});

export const setBackgroundOperationSchema = z.strictObject({
  kind: z.literal('setBackground'),
  pages: pageListSchema,
  background: backgroundSchema,
});

export const setHeaderFooterOperationSchema = z.strictObject({
  kind: z.literal('setHeaderFooter'),
  pages: pageListSchema,
  settings: headerFooterSchema,
});

/** Takes PaperForge's own furniture off the chosen pages. */
export const removeFurnitureOperationSchema = z.strictObject({
  kind: z.literal('removeFurniture'),
  pages: pageListSchema,
  kinds: z.array(furnitureKindSchema).min(1),
});

/** Fills in one or more fields, as one undoable step. */
export const setFieldValuesOperationSchema = z.strictObject({
  kind: z.literal('setFieldValues'),
  values: z.array(formValueChangeSchema).min(1).max(5000),
});

export const editOperationSchema = z.discriminatedUnion('kind', [
  rotatePagesOperationSchema,
  deletePagesOperationSchema,
  movePagesOperationSchema,
  duplicatePagesOperationSchema,
  insertBlankPagesOperationSchema,
  insertPagesOperationSchema,
  insertImagePagesOperationSchema,
  cropPagesOperationSchema,
  setPageLabelsOperationSchema,
  editTextOperationSchema,
  replaceTextOperationSchema,
  addTextOperationSchema,
  placeImageOperationSchema,
  deleteImageOperationSchema,
  addImageOperationSchema,
  addLinkOperationSchema,
  updateLinkOperationSchema,
  deleteLinkOperationSchema,
  setWatermarkOperationSchema,
  setBackgroundOperationSchema,
  setHeaderFooterOperationSchema,
  removeFurnitureOperationSchema,
  setFieldValuesOperationSchema,
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
