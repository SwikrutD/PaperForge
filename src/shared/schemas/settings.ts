import { z } from 'zod';
import { SETTINGS_VERSION } from '../constants/app';

export const themePreferenceSchema = z.enum(['system', 'light', 'dark']);
export type ThemePreference = z.infer<typeof themePreferenceSchema>;

export const resolvedThemeSchema = z.enum(['light', 'dark']);
export type ResolvedTheme = z.infer<typeof resolvedThemeSchema>;

export const windowStateSchema = z.object({
  width: z.number().int().min(640).max(20000),
  height: z.number().int().min(480).max(20000),
  x: z.number().int().optional(),
  y: z.number().int().optional(),
  maximized: z.boolean(),
});
export type WindowState = z.infer<typeof windowStateSchema>;

export const appearanceSettingsSchema = z.object({
  theme: themePreferenceSchema,
});

/** Identifiers for the panels the left rail can show. */
export const leftPanelIdSchema = z.enum(['pages', 'bookmarks', 'attachments', 'layers']);
export type LeftPanelId = z.infer<typeof leftPanelIdSchema>;

export const rightPanelIdSchema = z.enum(['properties', 'tools']);
export type RightPanelId = z.infer<typeof rightPanelIdSchema>;

export const PANEL_MIN_WIDTH = 200;
export const PANEL_MAX_WIDTH = 640;

export const panelStateSchema = z.object({
  visible: z.boolean(),
  width: z.number().int().min(PANEL_MIN_WIDTH).max(PANEL_MAX_WIDTH),
});
export type PanelState = z.infer<typeof panelStateSchema>;

export const layoutSettingsSchema = z.object({
  leftPanel: panelStateSchema,
  rightPanel: panelStateSchema,
  activeLeftPanel: leftPanelIdSchema,
  activeRightPanel: rightPanelIdSchema,
  commandBarVisible: z.boolean(),
});
export type LayoutSettings = z.infer<typeof layoutSettingsSchema>;

export const sessionSettingsSchema = z.object({
  /** Reopen the documents that were open when PaperForge last closed. */
  restoreOnStartup: z.boolean(),
  /** Paths of the documents open right now, maintained by the main process. */
  openDocuments: z.array(z.string().min(1)).max(50),
});
export type SessionSettings = z.infer<typeof sessionSettingsSchema>;

export const settingsSchema = z.object({
  version: z.literal(SETTINGS_VERSION),
  appearance: appearanceSettingsSchema,
  window: windowStateSchema,
  layout: layoutSettingsSchema,
  session: sessionSettingsSchema,
});
export type Settings = z.infer<typeof settingsSchema>;

/** Partial update accepted over IPC. Unknown keys are rejected outright. */
export const settingsPatchSchema = z.strictObject({
  appearance: appearanceSettingsSchema.partial().optional(),
  window: windowStateSchema.partial().optional(),
  layout: z
    .strictObject({
      leftPanel: panelStateSchema.partial().optional(),
      rightPanel: panelStateSchema.partial().optional(),
      activeLeftPanel: leftPanelIdSchema.optional(),
      activeRightPanel: rightPanelIdSchema.optional(),
      commandBarVisible: z.boolean().optional(),
    })
    .optional(),
  session: sessionSettingsSchema.partial().optional(),
});
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

/** Top-level sections, used when repairing a partially valid settings file. */
const SETTINGS_SECTIONS = ['appearance', 'window', 'layout', 'session'] as const;

export const DEFAULT_SETTINGS: Settings = {
  version: SETTINGS_VERSION,
  appearance: { theme: 'system' },
  window: { width: 1360, height: 900, maximized: false },
  layout: {
    leftPanel: { visible: true, width: 264 },
    rightPanel: { visible: false, width: 300 },
    activeLeftPanel: 'pages',
    activeRightPanel: 'properties',
    commandBarVisible: true,
  },
  session: { restoreOnStartup: true, openDocuments: [] },
};

/**
 * Applies a patch to settings without mutating the input. Undefined fields in
 * the patch leave the current value untouched, which keeps IPC payloads small.
 */
export function applySettingsPatch(current: Settings, patch: SettingsPatch): Settings {
  return settingsSchema.parse({
    version: SETTINGS_VERSION,
    appearance: mergeDefined(current.appearance, patch.appearance),
    window: mergeDefined(current.window, patch.window),
    layout: {
      ...mergeDefined(current.layout, {
        ...(patch.layout?.activeLeftPanel === undefined
          ? {}
          : { activeLeftPanel: patch.layout.activeLeftPanel }),
        ...(patch.layout?.activeRightPanel === undefined
          ? {}
          : { activeRightPanel: patch.layout.activeRightPanel }),
        ...(patch.layout?.commandBarVisible === undefined
          ? {}
          : { commandBarVisible: patch.layout.commandBarVisible }),
      }),
      leftPanel: mergeDefined(current.layout.leftPanel, patch.layout?.leftPanel),
      rightPanel: mergeDefined(current.layout.rightPanel, patch.layout?.rightPanel),
    },
    session: mergeDefined(current.session, patch.session),
  });
}

/**
 * Merges only the keys the patch actually provides. An explicit `undefined`
 * means "leave this alone", never "clear this value".
 */
function mergeDefined<T extends Record<string, unknown>>(
  base: T,
  patch: { [K in keyof T]?: T[K] | undefined } | undefined,
): T {
  if (patch === undefined) return base;
  const merged = { ...base };
  for (const key of Object.keys(patch) as Array<keyof T>) {
    const value = patch[key];
    if (value !== undefined) merged[key] = value;
  }
  return merged;
}

/**
 * Parses persisted settings, falling back to defaults for anything unreadable.
 * Returns whether the stored value had to be repaired so callers can log it.
 *
 * A file written by an older version is repaired rather than discarded: every
 * section that still validates is kept, and the rest reverts to defaults.
 */
export function parseStoredSettings(value: unknown): { settings: Settings; repaired: boolean } {
  const direct = settingsSchema.safeParse(value);
  if (direct.success) return { settings: direct.data, repaired: false };

  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const salvaged: Record<string, unknown> = {};
    for (const section of SETTINGS_SECTIONS) {
      const candidate = source[section];
      if (candidate === undefined) continue;
      // Salvage section by section so one bad section cannot discard the rest.
      if (settingsPatchSchema.safeParse({ [section]: candidate }).success) {
        salvaged[section] = candidate;
      }
    }
    const partial = settingsPatchSchema.safeParse(salvaged);
    if (partial.success) {
      return { settings: applySettingsPatch(DEFAULT_SETTINGS, partial.data), repaired: true };
    }
  }
  return { settings: DEFAULT_SETTINGS, repaired: true };
}
