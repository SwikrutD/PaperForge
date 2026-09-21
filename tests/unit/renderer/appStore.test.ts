// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../../src/shared/schemas/settings';
import { useAppStore } from '../../../src/renderer/stores/appStore';

const appInfo = {
  name: 'PaperForge',
  version: '0.1.0',
  isPackaged: false,
  platform: 'win32',
  arch: 'x64',
  locale: 'en-US',
  versions: { electron: '44.0.0', chrome: '140.0.0', node: '22.0.0', v8: '14.0' },
  paths: { userData: 'C:/u', logs: 'C:/l', temp: 'C:/t' },
};

function installBridge(responses: Record<string, unknown>): void {
  Object.defineProperty(window, 'paperforge', {
    configurable: true,
    value: {
      invoke: vi.fn((channel: string) => Promise.resolve(responses[channel])),
      subscribe: vi.fn(() => () => undefined),
    },
  });
}

beforeEach(() => {
  useAppStore.setState({ status: 'idle', settings: null, theme: null, appInfo: null, error: null });
});

describe('app store', () => {
  it('loads settings, theme and environment on startup', async () => {
    installBridge({
      'settings:get': { ok: true, data: DEFAULT_SETTINGS },
      'theme:getState': { ok: true, data: { preference: 'system', resolved: 'light' } },
      'app:getInfo': { ok: true, data: appInfo },
    });

    await useAppStore.getState().initialize();

    const state = useAppStore.getState();
    expect(state.status).toBe('ready');
    expect(state.settings).toEqual(DEFAULT_SETTINGS);
    expect(state.theme).toEqual({ preference: 'system', resolved: 'light' });
    expect(state.appInfo?.version).toBe('0.1.0');
    expect(state.error).toBeNull();
  });

  it('records a typed error instead of throwing when startup fails', async () => {
    installBridge({
      'settings:get': { ok: false, error: { code: 'settings/invalid', message: 'Bad settings.' } },
      'theme:getState': { ok: true, data: { preference: 'system', resolved: 'light' } },
      'app:getInfo': { ok: true, data: appInfo },
    });

    await useAppStore.getState().initialize();

    const state = useAppStore.getState();
    expect(state.status).toBe('error');
    expect(state.error).toMatchObject({ code: 'settings/invalid' });
  });

  it('restores the previous preference when a theme change is rejected', async () => {
    installBridge({
      'settings:get': { ok: true, data: DEFAULT_SETTINGS },
      'theme:getState': { ok: true, data: { preference: 'system', resolved: 'light' } },
      'app:getInfo': { ok: true, data: appInfo },
      'settings:patch': { ok: false, error: { code: 'io/write-failed', message: 'No.' } },
    });

    await useAppStore.getState().initialize();
    await useAppStore.getState().setThemePreference('dark');

    const state = useAppStore.getState();
    expect(state.settings?.appearance.theme).toBe('system');
    expect(state.error).toMatchObject({ code: 'io/write-failed' });
  });
});
