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

export const settingsSchema = z.object({
  version: z.literal(SETTINGS_VERSION),
  appearance: appearanceSettingsSchema,
  window: windowStateSchema,
});
export type Settings = z.infer<typeof settingsSchema>;

/** Partial update accepted over IPC. Unknown keys are rejected outright. */
export const settingsPatchSchema = z.strictObject({
  appearance: appearanceSettingsSchema.partial().optional(),
  window: windowStateSchema.partial().optional(),
});
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

export const DEFAULT_SETTINGS: Settings = {
  version: SETTINGS_VERSION,
  appearance: { theme: 'system' },
  window: { width: 1360, height: 900, maximized: false },
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
 */
export function parseStoredSettings(value: unknown): { settings: Settings; repaired: boolean } {
  const direct = settingsSchema.safeParse(value);
  if (direct.success) return { settings: direct.data, repaired: false };

  if (value !== null && typeof value === 'object') {
    const partial = settingsPatchSchema.safeParse({
      appearance: (value as Record<string, unknown>)['appearance'],
      window: (value as Record<string, unknown>)['window'],
    });
    if (partial.success) {
      return { settings: applySettingsPatch(DEFAULT_SETTINGS, partial.data), repaired: true };
    }
  }
  return { settings: DEFAULT_SETTINGS, repaired: true };
}
