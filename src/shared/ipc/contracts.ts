import { z } from 'zod';
import { appInfoSchema } from '../schemas/appInfo';
import { settingsPatchSchema, settingsSchema } from '../schemas/settings';
import { themeStateSchema } from '../schemas/theme';
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
} as const satisfies Record<EventChannel, z.ZodType>;

export type EventPayload<C extends EventChannel> = z.output<(typeof eventContracts)[C]>;

export const invokeChannels: readonly InvokeChannel[] = INVOKE_CHANNEL_NAMES;
export const eventChannels: readonly EventChannel[] = EVENT_CHANNEL_NAMES;
