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
import { recentFilesListSchema } from '../schemas/recentFiles';
import { settingsPatchSchema, settingsSchema } from '../schemas/settings';
import { themeStateSchema } from '../schemas/theme';
import { windowRuntimeStateSchema } from '../schemas/windowState';
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
  'recovery:discard': {
    request: z.strictObject({ sessionIds: z.array(z.string().min(1)).min(1).max(50) }),
    response: z.array(recoveryEntrySchema),
  },

  'shell:openExternal': {
    request: z.strictObject({ url: z.string().min(1).max(4096) }),
    response: z.void(),
  },
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
} as const satisfies Record<EventChannel, z.ZodType>;

export type EventPayload<C extends EventChannel> = z.output<(typeof eventContracts)[C]>;

export const invokeChannels: readonly InvokeChannel[] = INVOKE_CHANNEL_NAMES;
export const eventChannels: readonly EventChannel[] = EVENT_CHANNEL_NAMES;
