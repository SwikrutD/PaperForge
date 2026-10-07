import { z } from 'zod';
import { linkRectSchema, linkTargetSchema } from './link';
import { ocrPageResultSchema } from './ocr';
import { formFieldPropertiesSchema, formFieldTypeSchema, formValueChangeSchema } from './form';
import {
  backgroundSchema,
  furnitureKindSchema,
  headerFooterSchema,
  watermarkSchema,
} from './furniture';
import { annotationInputSchema, annotationPatchSchema } from './annotation';
import { pageBoxSchema, pageLabelStyleSchema } from './pages';
import { customMetadataEntrySchema, documentMetadataSchema } from './metadata';
import { sanitizeCategorySchema } from './sanitize';
import { rasterPageSchema, redactionAppearanceSchema, redactionRectSchema } from './redaction';
import { textStyleSchema } from './text';
import { structurePathSchema } from './accessibility';
import { bookmarkStyleSchema, bookmarkTargetSchema, outlinePathSchema } from './bookmark';
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

/**
 * Copies annotations onto the same page, moved by an offset. Each copy gets
 * the id asked for, so it can be selected the moment it is written.
 */
export const duplicateAnnotationsOperationSchema = z.strictObject({
  kind: z.literal('duplicateAnnotations'),
  copies: z
    .array(
      z.strictObject({
        id: z.string().min(1).max(120),
        newId: z.string().regex(/^pf-[A-Za-z0-9-]{1,80}$/),
      }),
    )
    .min(1)
    .max(100),
  dx: z.number().finite().min(-10_000).max(10_000),
  dy: z.number().finite().min(-10_000).max(10_000),
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
/**
 * For a picture inside a form drawn more than once: change only the drawing
 * the reader is pointing at (the form is copied for it), or every drawing of
 * the form. Left out, only this one changes.
 */
export const imageScopeSchema = z.enum(['this', 'all']);
export type ImageScope = z.infer<typeof imageScopeSchema>;

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
  scope: imageScopeSchema.optional(),
});

export const deleteImageOperationSchema = z.strictObject({
  kind: z.literal('deleteImage'),
  page: z.number().int().min(1).max(100_000),
  imageId: z.string().min(1).max(64),
  scope: imageScopeSchema.optional(),
});

/**
 * Draws a staged image on a page, over what is already there.
 *
 * The id is chosen by whoever adds the image, so it can be selected the moment
 * the change is written; it is kept with the image for as long as it is there.
 * Left out, one is made up.
 */
export const addImageOperationSchema = z.strictObject({
  kind: z.literal('addImage'),
  page: z.number().int().min(1).max(100_000),
  token: z.string().min(1).max(200),
  placement: imagePlacementSchema,
  opacity: z.number().min(0.05).max(1),
  imageId: z
    .string()
    .regex(/^pf-[A-Za-z0-9-]{1,40}$/)
    .optional(),
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

/**
 * Turns fields into part of the page. Null means every field there is.
 */
export const flattenFieldsOperationSchema = z.strictObject({
  kind: z.literal('flattenFields'),
  names: z.array(z.string().min(1).max(500)).max(5000).nullable(),
});

/** Turns marks — signatures, stamps, comments — into part of the page. */
export const flattenAnnotationsOperationSchema = z.strictObject({
  kind: z.literal('flattenAnnotations'),
  ids: z.array(z.string().min(1).max(120)).max(5000).nullable(),
});

const fieldRectSchema = z.strictObject({
  x: z.number().finite().min(-1_000_000).max(1_000_000),
  y: z.number().finite().min(-1_000_000).max(1_000_000),
  width: z.number().finite().min(1).max(1_000_000),
  height: z.number().finite().min(1).max(1_000_000),
});

/** Puts a new field on a page. */
export const addFormFieldOperationSchema = z.strictObject({
  kind: z.literal('addFormField'),
  page: z.number().int().min(1).max(100_000),
  name: z.string().min(1).max(500),
  fieldType: formFieldTypeSchema,
  rect: fieldRectSchema,
  options: z.array(z.string().max(500)).max(500).nullable(),
  properties: formFieldPropertiesSchema,
});

/** Changes what a field is, what it will accept, or where it sits. */
export const updateFormFieldOperationSchema = z.strictObject({
  kind: z.literal('updateFormField'),
  name: z.string().min(1).max(500),
  newName: z.string().min(1).max(500).nullable(),
  rect: fieldRectSchema.nullable(),
  options: z.array(z.string().max(500)).max(500).nullable(),
  properties: formFieldPropertiesSchema,
});

export const deleteFormFieldOperationSchema = z.strictObject({
  kind: z.literal('deleteFormField'),
  name: z.string().min(1).max(500),
});

/**
 * Puts the words read from a scan onto the pages they were read from, as an
 * invisible layer over the picture that is already there.
 */
export const addRecognisedTextOperationSchema = z.strictObject({
  kind: z.literal('addRecognisedText'),
  pages: z.array(ocrPageResultSchema).min(1).max(5000),
});

/**
 * Rewrites the document information dictionary.
 *
 * A null field removes that entry rather than writing an empty one, which is
 * the difference between "this document has no author" and "its author is the
 * empty string". `custom` replaces every non-standard entry there is.
 */
export const setMetadataOperationSchema = z.strictObject({
  kind: z.literal('setMetadata'),
  metadata: documentMetadataSchema,
  custom: z.array(customMetadataEntrySchema).max(500),
  /** Takes the XMP packet out as well, so the two cannot disagree. */
  removeXmpMetadata: z.boolean(),
});

/** Sets or clears the document's language, which readers announce. */
export const setDocumentLanguageOperationSchema = z.strictObject({
  kind: z.literal('setDocumentLanguage'),
  language: z.string().max(100).nullable(),
});

/**
 * Sets or clears the document's title — the information dictionary's
 * `/Title`, which is what a reader announces and a title bar can show.
 */
export const setDocumentTitleOperationSchema = z.strictObject({
  kind: z.literal('setDocumentTitle'),
  title: z.string().max(2000).nullable(),
});

/** Asks readers to show the title rather than the file name in their title bar. */
export const setDisplayDocTitleOperationSchema = z.strictObject({
  kind: z.literal('setDisplayDocTitle'),
  display: z.boolean(),
});

/**
 * Sets the alternate text of one element of the tag tree. The element's type
 * is restated so a tree that has changed underneath is refused rather than
 * written to the wrong element.
 */
export const setAltTextOperationSchema = z.strictObject({
  kind: z.literal('setAltText'),
  path: structurePathSchema,
  expectedType: z.string().min(1).max(100),
  alt: z.string().max(5000).nullable(),
});

/** Gives fields the accessible names readers announce (`/TU`). */
export const setFieldTooltipsOperationSchema = z.strictObject({
  kind: z.literal('setFieldTooltips'),
  fields: z
    .array(
      z.strictObject({
        name: z.string().min(1).max(500),
        tooltip: z.string().max(1000).nullable(),
      }),
    )
    .min(1)
    .max(5000),
});

/**
 * Makes the keyboard visit links and fields in the order the tag tree reads
 * the page (`/Tabs /S`). Null means every page.
 */
export const setTabOrderOperationSchema = z.strictObject({
  kind: z.literal('setTabOrder'),
  pages: pageListSchema.nullable(),
});

/**
 * Adds a bookmark under `parent` (null for the top level) at `index` among its
 * siblings, or at the end when the index is null.
 */
export const addBookmarkOperationSchema = z.strictObject({
  kind: z.literal('addBookmark'),
  parent: outlinePathSchema.nullable(),
  index: z.number().int().min(0).max(100_000).nullable(),
  title: z.string().min(1).max(2000),
  target: bookmarkTargetSchema,
  style: bookmarkStyleSchema,
});

/** Renames, restyles or re-points a bookmark. A null field is left as it is. */
export const updateBookmarkOperationSchema = z.strictObject({
  kind: z.literal('updateBookmark'),
  path: outlinePathSchema,
  expectTitle: z.string().max(2000),
  title: z.string().min(1).max(2000).nullable(),
  style: bookmarkStyleSchema.nullable(),
  target: bookmarkTargetSchema.nullable(),
  /** Whether the entry starts open, showing its children. */
  open: z.boolean().nullable(),
});

/** Removes a bookmark and everything nested under it. */
export const deleteBookmarkOperationSchema = z.strictObject({
  kind: z.literal('deleteBookmark'),
  path: outlinePathSchema,
  expectTitle: z.string().max(2000),
});

/**
 * Moves a bookmark, with what is nested under it, to `index` among the
 * children of `parent`. Both are read before the move, the way a drop target
 * is chosen.
 */
export const moveBookmarkOperationSchema = z.strictObject({
  kind: z.literal('moveBookmark'),
  path: outlinePathSchema,
  expectTitle: z.string().max(2000),
  parent: outlinePathSchema.nullable(),
  index: z.number().int().min(0).max(100_000),
});

/**
 * Sets which layers the document shows when it is opened. Layers are named the
 * way the viewer names them: "12R" for the group stored as object 12.
 */
export const setLayerDefaultsOperationSchema = z.strictObject({
  kind: z.literal('setLayerDefaults'),
  layers: z
    .array(z.strictObject({ id: z.string().regex(/^\d+R\d*$/), visible: z.boolean() }))
    .min(1)
    .max(5000),
});

/** Embeds files the main process has staged, by token. */
export const addAttachmentsOperationSchema = z.strictObject({
  kind: z.literal('addAttachments'),
  tokens: z.array(z.string().min(1).max(200)).min(1).max(100),
});

/** Takes embedded files out, named as the document files them. */
export const removeAttachmentsOperationSchema = z.strictObject({
  kind: z.literal('removeAttachments'),
  ids: z.array(z.string().min(1).max(500)).min(1).max(500),
});

/** Removes the hidden information in the categories chosen. */
export const sanitizeOperationSchema = z.strictObject({
  kind: z.literal('sanitize'),
  categories: z.array(sanitizeCategorySchema).min(1),
});

/**
 * Removes what lies under the marked areas and paints over where it was.
 *
 * Pages the window has drawn as pictures are named in `rasterPages`; any other
 * page is cut natively, and a page that cannot be cut safely without a
 * picture is refused rather than half-done.
 */
export const applyRedactionsOperationSchema = z.strictObject({
  kind: z.literal('applyRedactions'),
  marks: z
    .array(
      z.strictObject({
        page: pageNumberSchema,
        rects: z.array(redactionRectSchema).min(1).max(500),
        reason: z.string().max(120).nullable(),
      }),
    )
    .min(1)
    .max(5000),
  appearance: redactionAppearanceSchema,
  rasterPages: z.array(rasterPageSchema).max(5000),
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
  flattenFieldsOperationSchema,
  flattenAnnotationsOperationSchema,
  addFormFieldOperationSchema,
  updateFormFieldOperationSchema,
  deleteFormFieldOperationSchema,
  addRecognisedTextOperationSchema,
  addAnnotationsOperationSchema,
  updateAnnotationsOperationSchema,
  deleteAnnotationsOperationSchema,
  duplicateAnnotationsOperationSchema,
  setMetadataOperationSchema,
  setDocumentLanguageOperationSchema,
  setDocumentTitleOperationSchema,
  setDisplayDocTitleOperationSchema,
  setAltTextOperationSchema,
  setFieldTooltipsOperationSchema,
  setTabOrderOperationSchema,
  addBookmarkOperationSchema,
  updateBookmarkOperationSchema,
  deleteBookmarkOperationSchema,
  moveBookmarkOperationSchema,
  setLayerDefaultsOperationSchema,
  addAttachmentsOperationSchema,
  removeAttachmentsOperationSchema,
  sanitizeOperationSchema,
  applyRedactionsOperationSchema,
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
