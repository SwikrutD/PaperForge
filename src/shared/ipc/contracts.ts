import { z } from 'zod';
import { appInfoSchema } from '../schemas/appInfo';
import {
  fileChangeEventSchema,
  documentSessionSchema,
  openResultSchema,
  recoveryEntrySchema,
} from '../schemas/document';
import { annotationSchema, stampImageSchema } from '../schemas/annotation';
import {
  exportResultSchema,
  pageBoxesSchema,
  pageSourceSchema,
  splitPartSchema,
} from '../schemas/pages';
import {
  documentEditStateSchema,
  editTransactionSchema,
  qpdfStatusSchema,
  saveModeSchema,
  saveOutcomeSchema,
} from '../schemas/edit';
import {
  blankRequestSchema,
  combineRequestSchema,
  createOutcomeSchema,
  pageSetupSchema,
  stagedSourceSchema,
  stagedSourcesSchema,
} from '../schemas/create';
import { pageTextModelSchema } from '../schemas/text';
import { pageImageModelSchema } from '../schemas/image';
import { pageLinksModelSchema } from '../schemas/link';
import { formModelSchema } from '../schemas/form';
import { ocrOptionsSchema, ocrPageResultSchema, ocrStatusSchema } from '../schemas/ocr';
import {
  exportOptionsSchema,
  exportPagePayloadSchema,
  officeStatusSchema,
} from '../schemas/convert';
import { savedSignatureSchema, stageSignatureSchema } from '../schemas/signature';
import {
  embeddedFileSchema,
  saveAttachmentOutcomeSchema,
  stagedAttachmentSchema,
} from '../schemas/attachment';
import { documentPropertiesSchema } from '../schemas/metadata';
import {
  protectOutcomeSchema,
  protectRequestSchema,
  unprotectRequestSchema,
} from '../schemas/protect';
import { sanitizeReportSchema } from '../schemas/sanitize';
import {
  redactionMarkSchema,
  redactionPlanSchema,
  redactionSearchResultSchema,
  redactionSearchSchema,
} from '../schemas/redaction';
import { repairDiagnosisSchema, repairOutcomeSchema } from '../schemas/repair';
import {
  optimizeAnalysisSchema,
  optimizeOutcomeSchema,
  optimizeSettingsSchema,
} from '../schemas/optimize';
import { recentFilesListSchema } from '../schemas/recentFiles';
import { settingsPatchSchema, settingsSchema } from '../schemas/settings';
import { themeStateSchema } from '../schemas/theme';
import { windowRuntimeStateSchema } from '../schemas/windowState';
import { accessibilityReportSchema, readingOrderSchema } from '../schemas/accessibility';
import { bookmarkListSchema } from '../schemas/bookmark';
import {
  printerSchema,
  printOutcomeSchema,
  printPagePayloadSchema,
  printSettingsSchema,
} from '../schemas/print';
import {
  fileAssociationStatusSchema,
  launchPathsWaitingSchema,
  notificationRequestSchema,
  taskbarProgressSchema,
} from '../schemas/system';
import {
  EVENT_CHANNEL_NAMES,
  INVOKE_CHANNEL_NAMES,
  type EventChannel,
  type InvokeChannel,
} from './channelNames';

export type { EventChannel, InvokeChannel };
export {
  EVENT_CHANNEL_NAMES,
  INVOKE_CHANNEL_NAMES,
  isEventChannel,
  isInvokeChannel,
} from './channelNames';

interface InvokeContract {
  request: z.ZodType;
  response: z.ZodType;
}

/**
 * Single source of truth for renderer -> main requests.
 *
 * Every channel declares a request and a response schema. The main process
 * validates requests before a handler runs and validates responses before they
 * leave, so a malformed payload can never reach either side untyped.
 */
export const invokeContracts = {
  'app:getInfo': { request: z.void(), response: appInfoSchema },
  'settings:get': { request: z.void(), response: settingsSchema },
  'settings:patch': { request: settingsPatchSchema, response: settingsSchema },
  'theme:getState': { request: z.void(), response: themeStateSchema },
  'recentFiles:list': { request: z.void(), response: recentFilesListSchema },
  'recentFiles:clear': { request: z.void(), response: recentFilesListSchema },
  'window:getState': { request: z.void(), response: windowRuntimeStateSchema },
  'window:toggleFullScreen': { request: z.void(), response: windowRuntimeStateSchema },
  'window:openNew': { request: z.void(), response: z.void() },
  'window:close': { request: z.void(), response: z.void() },

  'recentFiles:setPinned': {
    request: z.strictObject({ path: z.string().min(1), pinned: z.boolean() }),
    response: recentFilesListSchema,
  },
  'recentFiles:remove': {
    request: z.strictObject({ path: z.string().min(1) }),
    response: recentFilesListSchema,
  },

  'files:openDialog': { request: z.void(), response: openResultSchema },
  'files:openPaths': {
    request: z.strictObject({ paths: z.array(z.string().min(1)).min(1).max(50) }),
    response: openResultSchema,
  },
  'files:list': { request: z.void(), response: z.array(documentSessionSchema) },
  'files:close': {
    request: z.strictObject({ sessionId: z.string().min(1) }),
    response: z.void(),
  },
  'files:restoreSession': { request: z.void(), response: openResultSchema },
  'files:revealInExplorer': {
    request: z.strictObject({ path: z.string().min(1) }),
    response: z.void(),
  },

  'edit:state': {
    request: z.strictObject({ sessionId: z.string().min(1) }),
    response: documentEditStateSchema,
  },
  'edit:apply': {
    request: z.strictObject({
      sessionId: z.string().min(1),
      transaction: editTransactionSchema,
    }),
    response: documentEditStateSchema,
  },
  'edit:undo': {
    request: z.strictObject({ sessionId: z.string().min(1) }),
    response: documentEditStateSchema,
  },
  'edit:redo': {
    request: z.strictObject({ sessionId: z.string().min(1) }),
    response: documentEditStateSchema,
  },
  'edit:revert': {
    request: z.strictObject({ sessionId: z.string().min(1) }),
    response: documentEditStateSchema,
  },
  'files:save': {
    request: z.strictObject({
      sessionId: z.string().min(1),
      mode: saveModeSchema,
      /** Save anyway, after the reader was warned the file changed on disk. */
      force: z.boolean().optional(),
      /** Added to the suggested file name for Save As and Save a Copy, e.g. "redacted". */
      nameSuffix: z
        .string()
        .regex(/^[A-Za-z0-9 _-]{1,40}$/)
        .optional(),
    }),
    response: saveOutcomeSchema,
  },
  /** What each page of a document says about its own geometry. */
  'pages:boxes': {
    request: z.strictObject({ sessionId: z.string().min(1) }),
    response: z.array(pageBoxesSchema),
  },
  /** Stages another PDF to take pages from; null when nothing was chosen. */
  'pages:choosePdfSource': {
    request: z.strictObject({ sessionId: z.string().min(1) }),
    response: pageSourceSchema.nullable(),
  },
  'pages:chooseImageSource': {
    request: z.strictObject({ sessionId: z.string().min(1) }),
    response: pageSourceSchema.nullable(),
  },
  /** Stages another open document, for moving pages between tabs. */
  'pages:stageOpenDocument': {
    request: z.strictObject({
      sessionId: z.string().min(1),
      fromSessionId: z.string().min(1),
    }),
    response: pageSourceSchema,
  },
  /** Writes pages out as new documents, asking where they should go. */
  'pages:extract': {
    request: z.strictObject({
      sessionId: z.string().min(1),
      parts: z.array(splitPartSchema).min(1).max(2000),
      mode: z.enum(['single', 'perPage']),
    }),
    response: exportResultSchema,
  },

  /** The text a page draws, as the editor needs to see it. */
  'text:page': {
    request: z.strictObject({
      sessionId: z.string().min(1),
      page: z.number().int().min(1).max(100_000),
    }),
    response: pageTextModelSchema,
  },

  /**
   * Whether the font a run is drawn in can write some text, and which
   * character stops it when it cannot.
   */
  'text:canWrite': {
    request: z.strictObject({
      sessionId: z.string().min(1),
      page: z.number().int().min(1).max(100_000),
      runId: z.string().min(1).max(64),
      text: z.string().max(4000),
    }),
    response: z.strictObject({
      ok: z.boolean(),
      missing: z.string().max(8).nullable(),
    }),
  },

  /** The images a page draws, with the boxes they are drawn in. */
  'images:page': {
    request: z.strictObject({
      sessionId: z.string().min(1),
      page: z.number().int().min(1).max(100_000),
    }),
    response: pageImageModelSchema,
  },

  /** Stages an image file to draw on a page, or in place of another. */
  'images:choose': {
    request: z.strictObject({ sessionId: z.string().min(1) }),
    response: stampImageSchema.nullable(),
  },

  /** The links a page carries, with where each one goes. */
  'links:page': {
    request: z.strictObject({
      sessionId: z.string().min(1),
      page: z.number().int().min(1).max(100_000),
    }),
    response: pageLinksModelSchema,
  },

  /** The whole form a document carries, with what each field holds. */
  'forms:model': {
    request: z.strictObject({ sessionId: z.string().min(1) }),
    response: formModelSchema,
  },

  /** The signatures this computer has been asked to keep. */
  'signatures:list': { request: z.void(), response: z.array(savedSignatureSchema) },

  /** Stages a signature for placing, and keeps it when the reader asked. */
  'signatures:stage': { request: stageSignatureSchema, response: stampImageSchema },

  'signatures:remove': {
    request: z.strictObject({ id: z.string().min(1).max(64) }),
    response: z.array(savedSignatureSchema),
  },

  /** Forgets every saved signature, from Settings → Privacy. */
  'signatures:clear': { request: z.void(), response: z.null() },

  /** Where PaperForge found Tesseract, and the languages it can read. */
  'ocr:status': { request: z.void(), response: ocrStatusSchema },

  /** Points PaperForge at a Tesseract program, or forgets the one it has. */
  'ocr:locate': {
    request: z.strictObject({ clear: z.boolean().optional() }),
    response: ocrStatusSchema,
  },

  /** Points PaperForge at a folder of language data, or forgets it. */
  'ocr:locateLanguages': {
    request: z.strictObject({ clear: z.boolean().optional() }),
    response: ocrStatusSchema,
  },

  /**
   * Reads one page that the window has rendered. The picture crosses as
   * base64 because that is the only shape a validated payload can take.
   */
  'ocr:recognisePage': {
    request: z.strictObject({
      sessionId: z.string().min(1),
      page: z.number().int().min(1).max(100_000),
      image: z.string().min(1).max(64_000_000),
      options: ocrOptionsSchema,
    }),
    response: ocrPageResultSchema,
  },

  /** Stops the run in flight for a document. */
  'ocr:cancel': {
    request: z.strictObject({ sessionId: z.string().min(1) }),
    response: z.null(),
  },

  /** Writes what was read to a text file the reader chooses. */
  'ocr:writeText': {
    request: z.strictObject({
      sessionId: z.string().min(1),
      text: z.string().max(40_000_000),
    }),
    response: exportResultSchema,
  },

  /**
   * Starts an export: the reader chooses where it goes, and the window then
   * sends the pages one at a time.
   */
  'convert:start': {
    request: z.strictObject({
      sessionId: z.string().min(1),
      options: exportOptionsSchema,
    }),
    response: z.strictObject({ exportId: z.string().max(64).nullable() }),
  },

  /** One page of an export, as the window rendered and read it. */
  'convert:page': { request: exportPagePayloadSchema, response: z.null() },

  /** Writes whatever the export gathered, and says what it wrote. */
  'convert:finish': {
    request: z.strictObject({ exportId: z.string().min(1).max(64) }),
    response: exportResultSchema,
  },

  'convert:cancel': {
    request: z.strictObject({ exportId: z.string().min(1).max(64) }),
    response: exportResultSchema,
  },

  /** Whether a local LibreOffice was found, for Office files. */
  'convert:officeStatus': { request: z.void(), response: officeStatusSchema },

  /** Points PaperForge at a LibreOffice, or forgets the one it has. */
  'convert:locateOffice': {
    request: z.strictObject({ clear: z.boolean().optional() }),
    response: officeStatusSchema,
  },

  /** Writes an image the page draws out to a file the reader chooses. */
  'images:export': {
    request: z.strictObject({
      sessionId: z.string().min(1),
      page: z.number().int().min(1).max(100_000),
      imageId: z.string().min(1).max(64),
    }),
    response: exportResultSchema,
  },

  /**
   * Stages local files for a new document: they are read, converted to pages
   * by their provider, and listed by name and page count. The picker is
   * native, so the renderer never names a file.
   */
  'sources:add': {
    request: z.strictObject({ setup: pageSetupSchema }),
    response: stagedSourcesSchema,
  },
  'sources:list': { request: z.void(), response: z.array(stagedSourceSchema) },
  'sources:remove': {
    request: z.strictObject({ ids: z.array(z.string().min(1).max(200)).min(1).max(1000) }),
    response: z.array(stagedSourceSchema),
  },
  'sources:clear': { request: z.void(), response: z.array(stagedSourceSchema) },
  /** Converts the staged files again on different paper. */
  'sources:setPageSetup': {
    request: z.strictObject({ setup: pageSetupSchema }),
    response: stagedSourcesSchema,
  },
  /** Makes an empty document, asking where it should go. */
  'create:blank': {
    request: blankRequestSchema,
    response: createOutcomeSchema,
  },
  /** Makes one document out of the staged files. */
  'create:combine': {
    request: combineRequestSchema,
    response: createOutcomeSchema,
  },

  /** Every annotation in a document, as the file itself records them. */
  'annotations:list': {
    request: z.strictObject({ sessionId: z.string().min(1) }),
    response: z.array(annotationSchema),
  },
  /**
   * Stages an image for stamping and hands back a token. The bytes stay in the
   * main process; the renderer only places the stamp.
   */
  'annotations:stageStampImage': {
    request: z.strictObject({ sessionId: z.string().min(1) }),
    response: stampImageSchema.nullable(),
  },

  /** Metadata, fonts, page sizes and the security summary, as they stand now. */
  'document:properties': {
    request: z.strictObject({ sessionId: z.string().min(1) }),
    response: documentPropertiesSchema,
  },

  'attachments:list': {
    request: z.strictObject({ sessionId: z.string().min(1) }),
    response: z.array(embeddedFileSchema),
  },
  /** Opens a picker and stages what was chosen. Bytes stay in the main process. */
  'attachments:choose': {
    request: z.strictObject({ sessionId: z.string().min(1) }),
    response: z.array(stagedAttachmentSchema),
  },
  /**
   * Writes one attachment to a place the reader picks. PaperForge never opens
   * an embedded file; it only hands the bytes to the filesystem.
   */
  'attachments:save': {
    request: z.strictObject({ sessionId: z.string().min(1), id: z.string().min(1).max(500) }),
    response: saveAttachmentOutcomeSchema,
  },

  /** What the document carries besides the pages it shows. Changes nothing. */
  'sanitize:scan': {
    request: z.strictObject({ sessionId: z.string().min(1) }),
    response: sanitizeReportSchema,
  },

  /** The Accessibility Check, run on the revision being shown. Changes nothing. */
  'accessibility:check': {
    request: z.strictObject({ sessionId: z.string().min(1) }),
    response: accessibilityReportSchema,
  },
  /** One page's content in the order the document's tags read it. */
  'accessibility:readingOrder': {
    request: z.strictObject({
      sessionId: z.string().min(1),
      page: z.number().int().min(1).max(100_000),
    }),
    response: readingOrderSchema,
  },

  /** The bookmarks, addressed the way the bookmark operations address them. */
  'bookmarks:list': {
    request: z.strictObject({ sessionId: z.string().min(1) }),
    response: bookmarkListSchema,
  },

  /** Finds text to mark, as the boxes of the glyphs redaction would remove. */
  'redaction:find': {
    request: z.strictObject({ sessionId: z.string().min(1), search: redactionSearchSchema }),
    response: redactionSearchResultSchema,
  },

  /** What applying the marks would remove, page by page. Changes nothing. */
  'redaction:plan': {
    request: z.strictObject({
      sessionId: z.string().min(1),
      marks: z.array(redactionMarkSchema).min(1).max(5000),
    }),
    response: redactionPlanSchema,
  },

  /**
   * Stages a page the window has drawn, with its marks painted on, to stand
   * in for a page that cannot be cut. The picture crosses as base64.
   */
  'redaction:stagePage': {
    request: z.strictObject({
      sessionId: z.string().min(1),
      page: z.number().int().min(1).max(100_000),
      image: z.string().min(1).max(64_000_000),
    }),
    response: z.strictObject({ token: z.string().min(1) }),
  },

  /**
   * Writes a protected copy. The passwords travel on this one request and are
   * handed to qpdf; they are never logged, stored or sent back.
   */
  'protect:apply': { request: protectRequestSchema, response: protectOutcomeSchema },
  /** Writes a copy with its security removed, given a password that opens it. */
  'protect:remove': { request: unprotectRequestSchema, response: protectOutcomeSchema },

  /** What qpdf and PaperForge's own engine make of the document's structure. */
  'repair:diagnose': {
    request: z.strictObject({ sessionId: z.string().min(1) }),
    response: repairDiagnosisSchema,
  },
  /** Asks where to put a repaired copy, writes it, and says how. */
  'repair:save': {
    request: z.strictObject({ sessionId: z.string().min(1) }),
    response: repairOutcomeSchema,
  },

  /** What the document holds that an optimisation could act on. */
  'optimize:analyze': {
    request: z.strictObject({ sessionId: z.string().min(1) }),
    response: optimizeAnalysisSchema,
  },
  /** Optimises the revision being shown into a new, undoable revision. */
  'optimize:run': {
    request: z.strictObject({ sessionId: z.string().min(1), settings: optimizeSettingsSchema }),
    response: optimizeOutcomeSchema,
  },

  'tools:qpdfStatus': { request: z.void(), response: qpdfStatusSchema },
  /** Opens a picker for the qpdf executable, or clears the configured one. */
  'tools:locateQpdf': {
    request: z.strictObject({ clear: z.boolean().optional() }),
    response: qpdfStatusSchema,
  },

  'recovery:list': { request: z.void(), response: z.array(recoveryEntrySchema) },
  'recovery:restore': {
    request: z.strictObject({ sessionIds: z.array(z.string().min(1)).min(1).max(50) }),
    response: openResultSchema,
  },
  'recovery:saveCopy': {
    request: z.strictObject({
      sessionId: z.string().min(1),
      displayName: z.string().min(1).max(260),
    }),
    response: openResultSchema,
  },
  'recovery:discard': {
    request: z.strictObject({ sessionIds: z.array(z.string().min(1)).min(1).max(50) }),
    response: z.array(recoveryEntrySchema),
  },

  'shell:openExternal': {
    request: z.strictObject({ url: z.string().min(1).max(4096) }),
    response: z.void(),
  },

  /** The printers Windows knows about, default first. */
  'print:printers': { request: z.void(), response: z.array(printerSchema) },
  /** Starts a print job; the window then sends its pages one at a time. */
  'print:start': {
    request: z.strictObject({
      sessionId: z.string().min(1),
      settings: printSettingsSchema,
      pages: z.number().int().min(1).max(100_000),
    }),
    response: z.strictObject({ printId: z.string().min(1).max(64) }),
  },
  'print:page': { request: printPagePayloadSchema, response: z.null() },
  /** Lays the pages out and hands them to the printer. */
  'print:finish': {
    request: z.strictObject({ printId: z.string().min(1).max(64) }),
    response: printOutcomeSchema,
  },
  'print:cancel': {
    request: z.strictObject({ printId: z.string().min(1).max(64) }),
    response: z.null(),
  },

  /**
   * Opens the files Explorer, Open With or a jump list handed PaperForge and
   * that are waiting for this window. The renderer never names them.
   */
  'files:openLaunchPaths': { request: z.void(), response: openResultSchema },
  /** Shows the progress of long work on this window's taskbar button. */
  'window:setProgress': { request: taskbarProgressSchema, response: z.null() },
  /** A Windows notification, shown only while this window is not in front. */
  'window:notify': { request: notificationRequestSchema, response: z.null() },
  'system:fileAssociation': { request: z.void(), response: fileAssociationStatusSchema },
  /** Adds PaperForge to, or takes it off, the Open With list for PDFs. */
  'system:setOpenWith': {
    request: z.strictObject({ enabled: z.boolean() }),
    response: fileAssociationStatusSchema,
  },
  /** Opens Windows Settings at PaperForge's default-app choices. */
  'system:openDefaultApps': { request: z.void(), response: z.null() },
} as const satisfies Record<InvokeChannel, InvokeContract>;

/** Request payload as callers pass it. */
export type InvokeRequest<C extends InvokeChannel> = z.input<
  (typeof invokeContracts)[C]['request']
>;
/** Request payload as a handler sees it, i.e. after validation. */
export type InvokeInput<C extends InvokeChannel> = z.output<(typeof invokeContracts)[C]['request']>;
export type InvokeResponse<C extends InvokeChannel> = z.output<
  (typeof invokeContracts)[C]['response']
>;

/**
 * Single source of truth for main -> renderer pushes. The renderer validates
 * these before acting on them.
 */
export const eventContracts = {
  'theme:changed': themeStateSchema,
  'settings:changed': settingsSchema,
  'recentFiles:changed': recentFilesListSchema,
  'window:stateChanged': windowRuntimeStateSchema,
  'files:changed': fileChangeEventSchema,
  'files:launchPathsWaiting': launchPathsWaitingSchema,
} as const satisfies Record<EventChannel, z.ZodType>;

export type EventPayload<C extends EventChannel> = z.output<(typeof eventContracts)[C]>;

export const invokeChannels: readonly InvokeChannel[] = INVOKE_CHANNEL_NAMES;
export const eventChannels: readonly EventChannel[] = EVENT_CHANNEL_NAMES;
