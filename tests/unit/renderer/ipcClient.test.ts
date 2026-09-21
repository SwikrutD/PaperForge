// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../src/shared/errors/appError';
import { DEFAULT_SETTINGS } from '../../../src/shared/schemas/settings';
import { invoke, subscribe } from '../../../src/renderer/services/ipcClient';

interface BridgeStub {
  invoke: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
}

function installBridge(stub: Partial<BridgeStub>): BridgeStub {
  const bridge: BridgeStub = {
    invoke: stub.invoke ?? vi.fn(),
    subscribe: stub.subscribe ?? vi.fn(() => () => undefined),
  };
  Object.defineProperty(window, 'paperforge', { value: bridge, configurable: true });
  return bridge;
}

afterEach(() => {
  Reflect.deleteProperty(window, 'paperforge');
});

describe('renderer IPC client', () => {
  it('returns validated data from a success envelope', async () => {
    installBridge({ invoke: vi.fn().mockResolvedValue({ ok: true, data: DEFAULT_SETTINGS }) });
    await expect(invoke('settings:get')).resolves.toEqual(DEFAULT_SETTINGS);
  });

  it('turns a failure envelope into a typed AppError', async () => {
    installBridge({
      invoke: vi.fn().mockResolvedValue({
        ok: false,
        error: {
          code: 'io/permission-denied',
          message: 'Windows denied access.',
          details: 'EACCES',
        },
      }),
    });

    await expect(invoke('settings:get')).rejects.toBeInstanceOf(AppError);
    await expect(invoke('settings:get')).rejects.toMatchObject({
      code: 'io/permission-denied',
      details: 'EACCES',
    });
  });

  it('refuses a response that does not match the contract', async () => {
    installBridge({ invoke: vi.fn().mockResolvedValue({ ok: true, data: { nonsense: 1 } }) });
    await expect(invoke('settings:get')).rejects.toMatchObject({ code: 'ipc/invalid-response' });
  });

  it('passes the payload through to the bridge', async () => {
    const bridge = installBridge({
      invoke: vi.fn().mockResolvedValue({ ok: true, data: DEFAULT_SETTINGS }),
    });
    await invoke('settings:patch', { appearance: { theme: 'dark' } });
    expect(bridge.invoke).toHaveBeenCalledWith('settings:patch', { appearance: { theme: 'dark' } });
  });

  it('drops events whose payload fails validation', () => {
    let emit: ((payload: unknown) => void) | undefined;
    const unsubscribe = vi.fn();
    installBridge({
      subscribe: vi.fn((_channel: string, listener: (payload: unknown) => void) => {
        emit = listener;
        return unsubscribe;
      }),
    });

    const listener = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const dispose = subscribe('theme:changed', listener);

    emit?.({ preference: 'system', resolved: 'dark' });
    emit?.({ preference: 'system', resolved: 'sepia' });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ preference: 'system', resolved: 'dark' });
    expect(consoleError).toHaveBeenCalled();

    dispose();
    expect(unsubscribe).toHaveBeenCalled();
  });
});
