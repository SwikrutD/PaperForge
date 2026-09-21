import { describe, expect, it } from 'vitest';
import {
  applySettingsPatch,
  DEFAULT_SETTINGS,
  parseStoredSettings,
  settingsPatchSchema,
} from '../../../src/shared/schemas/settings';

describe('settings schema', () => {
  it('applies a partial patch without touching untouched sections', () => {
    const next = applySettingsPatch(DEFAULT_SETTINGS, { appearance: { theme: 'dark' } });
    expect(next.appearance.theme).toBe('dark');
    expect(next.window).toEqual(DEFAULT_SETTINGS.window);
  });

  it('does not mutate the input settings', () => {
    const current = structuredClone(DEFAULT_SETTINGS);
    applySettingsPatch(current, { window: { width: 1000 } });
    expect(current).toEqual(DEFAULT_SETTINGS);
  });

  it('rejects unknown keys in a patch', () => {
    const result = settingsPatchSchema.safeParse({ appearance: { theme: 'dark' }, evil: true });
    expect(result.success).toBe(false);
  });

  it('rejects out-of-range window sizes', () => {
    const result = settingsPatchSchema.safeParse({ window: { width: 10 } });
    expect(result.success).toBe(false);
  });

  it('accepts a valid stored file unchanged', () => {
    const stored = applySettingsPatch(DEFAULT_SETTINGS, { appearance: { theme: 'light' } });
    expect(parseStoredSettings(stored)).toEqual({ settings: stored, repaired: false });
  });

  it('repairs a partially valid file instead of failing', () => {
    const { settings, repaired } = parseStoredSettings({
      version: 99,
      appearance: { theme: 'dark' },
      window: { width: 1200, height: 800, maximized: true },
    });
    expect(repaired).toBe(true);
    expect(settings.appearance.theme).toBe('dark');
    expect(settings.window.width).toBe(1200);
    expect(settings.version).toBe(DEFAULT_SETTINGS.version);
  });

  it('falls back to defaults for unreadable content', () => {
    expect(parseStoredSettings('not json at all')).toEqual({
      settings: DEFAULT_SETTINGS,
      repaired: true,
    });
    expect(parseStoredSettings(undefined).settings).toEqual(DEFAULT_SETTINGS);
  });
});
