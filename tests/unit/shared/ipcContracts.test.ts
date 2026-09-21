import { describe, expect, it } from 'vitest';
import {
  EVENT_CHANNEL_NAMES,
  INVOKE_CHANNEL_NAMES,
  isEventChannel,
  isInvokeChannel,
} from '../../../src/shared/ipc/channelNames';
import { eventContracts, invokeContracts } from '../../../src/shared/ipc/contracts';
import { ipcFailureSchema, ipcSuccessSchema } from '../../../src/shared/ipc/result';
import { settingsSchema } from '../../../src/shared/schemas/settings';

describe('IPC contracts', () => {
  it('keeps the preload allowlist and the schema map in sync', () => {
    expect(Object.keys(invokeContracts).sort()).toEqual([...INVOKE_CHANNEL_NAMES].sort());
    expect(Object.keys(eventContracts).sort()).toEqual([...EVENT_CHANNEL_NAMES].sort());
  });

  it('rejects channel names that are not on the allowlist', () => {
    expect(isInvokeChannel('settings:get')).toBe(true);
    expect(isInvokeChannel('shell:execute')).toBe(false);
    expect(isInvokeChannel(undefined)).toBe(false);
    expect(isEventChannel('theme:changed')).toBe(true);
    expect(isEventChannel('__proto__')).toBe(false);
  });

  it('validates settings patches at the boundary', () => {
    const contract = invokeContracts['settings:patch'];
    expect(contract.request.safeParse({ appearance: { theme: 'dark' } }).success).toBe(true);
    expect(contract.request.safeParse({ appearance: { theme: 'neon' } }).success).toBe(false);
    expect(contract.request.safeParse('dark').success).toBe(false);
  });

  it('describes success and failure envelopes', () => {
    const success = ipcSuccessSchema(settingsSchema);
    expect(success.safeParse({ ok: true, data: 'nope' }).success).toBe(false);
    expect(
      ipcFailureSchema.safeParse({ ok: false, error: { code: 'io/not-found', message: 'x' } })
        .success,
    ).toBe(true);
    expect(
      ipcFailureSchema.safeParse({ ok: false, error: { code: 'made/up', message: 'x' } }).success,
    ).toBe(false);
  });
});
