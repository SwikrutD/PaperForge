import { z } from 'zod';
import { appInfoSchema } from '../schemas/appInfo';
import {
  fileChangeEventSchema,
  documentSessionSchema,
  openResultSchema,
  recoveryEntrySchema,
} from '../schemas/document';
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
