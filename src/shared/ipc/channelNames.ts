/**
 * Channel allowlists, deliberately free of any schema imports so the preload
 * bundle stays tiny. `contracts.ts` is type-checked against these names, so a
 * channel cannot exist in one place and be missing from the other.
 */
export const INVOKE_CHANNEL_NAMES = [
  'app:getInfo',
  'settings:get',
  'settings:patch',
  'theme:getState',
] as const;

export type InvokeChannel = (typeof INVOKE_CHANNEL_NAMES)[number];

export const EVENT_CHANNEL_NAMES = ['theme:changed', 'settings:changed'] as const;

export type EventChannel = (typeof EVENT_CHANNEL_NAMES)[number];

export function isInvokeChannel(value: unknown): value is InvokeChannel {
  return (INVOKE_CHANNEL_NAMES as readonly string[]).includes(value as string);
}

export function isEventChannel(value: unknown): value is EventChannel {
  return (EVENT_CHANNEL_NAMES as readonly string[]).includes(value as string);
}
