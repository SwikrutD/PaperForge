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

describe('layout settings', () => {
  it('merges nested panel fields without dropping siblings', () => {
    const next = applySettingsPatch(DEFAULT_SETTINGS, { layout: { leftPanel: { width: 320 } } });
    expect(next.layout.leftPanel).toEqual({ visible: true, width: 320 });
    expect(next.layout.rightPanel).toEqual(DEFAULT_SETTINGS.layout.rightPanel);
    expect(next.layout.activeLeftPanel).toBe(DEFAULT_SETTINGS.layout.activeLeftPanel);
  });

  it('rejects panel widths outside the resizable range', () => {
    expect(settingsPatchSchema.safeParse({ layout: { leftPanel: { width: 40 } } }).success).toBe(
      false,
    );
    expect(settingsPatchSchema.safeParse({ layout: { rightPanel: { width: 5000 } } }).success).toBe(
      false,
    );
  });

  it('rejects unknown panel identifiers', () => {
    expect(settingsPatchSchema.safeParse({ layout: { activeLeftPanel: 'comments' } }).success).toBe(
      false,
    );
  });

  it('salvages valid sections when another section is corrupt', () => {
    const { settings, repaired } = parseStoredSettings({
      version: 1,
      appearance: { theme: 'dark' },
      window: 'nonsense',
      layout: { leftPanel: { visible: false, width: 240 }, activeLeftPanel: 'bookmarks' },
    });

    expect(repaired).toBe(true);
    expect(settings.appearance.theme).toBe('dark');
    expect(settings.window).toEqual(DEFAULT_SETTINGS.window);
    expect(settings.layout.leftPanel).toEqual({ visible: false, width: 240 });
    expect(settings.layout.activeLeftPanel).toBe('bookmarks');
  });
});

describe('the menu bar setting', () => {
  /** A layout as an earlier PaperForge saved it, with the View-menu toggle off. */
  const legacyLayout = {
    leftPanel: { visible: false, width: 300 },
    rightPanel: { visible: true, width: 400 },
    activeLeftPanel: 'bookmarks',
    activeRightPanel: 'tools',
    commandBarVisible: false,
  };

  it('shows the menu bar by default', () => {
    expect(DEFAULT_SETTINGS.layout.menuBarVisible).toBe(true);
  });

  it('is saved when turned off, and when turned back on', () => {
    const hidden = applySettingsPatch(DEFAULT_SETTINGS, { layout: { menuBarVisible: false } });
    expect(parseStoredSettings(structuredClone(hidden)).settings.layout.menuBarVisible).toBe(false);

    const shown = applySettingsPatch(hidden, { layout: { menuBarVisible: true } });
    expect(parseStoredSettings(structuredClone(shown)).settings.layout.menuBarVisible).toBe(true);
  });

  it('no longer accepts the old Command Bar field', () => {
    expect(settingsPatchSchema.safeParse({ layout: { commandBarVisible: false } }).success).toBe(
      false,
    );
  });

  it('shows the menu bar again for a file saved with the old toggle off, keeping the rest of the layout', () => {
    const { settings } = parseStoredSettings({ ...DEFAULT_SETTINGS, layout: legacyLayout });

    expect(settings.layout.menuBarVisible).toBe(true);
    expect(settings.layout).not.toHaveProperty('commandBarVisible');
    expect(settings.layout.leftPanel).toEqual({ visible: false, width: 300 });
    expect(settings.layout.rightPanel).toEqual({ visible: true, width: 400 });
    expect(settings.layout.activeLeftPanel).toBe('bookmarks');
    expect(settings.layout.activeRightPanel).toBe('tools');
  });

  it('keeps a menu bar hidden from Settings hidden', () => {
    const { commandBarVisible: _old, ...layout } = legacyLayout;
    const { settings } = parseStoredSettings({
      ...DEFAULT_SETTINGS,
      layout: { ...layout, menuBarVisible: false },
    });
    expect(settings.layout.menuBarVisible).toBe(false);
  });
});
