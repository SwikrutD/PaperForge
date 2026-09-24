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

export const rightPanelIdSchema = z.enum(['properties', 'comments', 'tools']);
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

export const editingSettingsSchema = z.object({
  /**
   * The name new comments are signed with. Empty means "whoever is signed in",
   * which the renderer resolves from the application info.
   */
  annotationAuthor: z.string().max(200),
});
export type EditingSettings = z.infer<typeof editingSettingsSchema>;

export const toolsSettingsSchema = z.object({
  /**
   * Where the local qpdf executable is, when the reader has pointed PaperForge
   * at one. Null means "look for it in the usual places".
   */
  qpdfPath: z.string().max(4096).nullable(),
  /** Where the local Tesseract executable is, when one has been chosen. */
  tesseractPath: z.string().max(4096).nullable(),
  /** A folder of Tesseract language data, when one has been chosen. */
  tessdataPath: z.string().max(4096).nullable(),
  /** Where the local LibreOffice is, when the reader has chosen one. */
  libreOfficePath: z.string().max(4096).nullable(),
});
export type ToolsSettings = z.infer<typeof toolsSettingsSchema>;

/** How PaperForge reads a scan, unless the dialog says otherwise. */
export const ocrSettingsSchema = z.object({
  /** Tesseract language codes, in the order it should try them. */
  languages: z.array(z.string().min(1).max(32)).max(8),
  /** How finely a page is rendered before it is read. */
  dpi: z.number().int().min(72).max(1200),
  /** Greys the picture and lifts its contrast before reading it. */
  preprocess: z.boolean(),
});
export type OcrSettings = z.infer<typeof ocrSettingsSchema>;

export const settingsSchema = z.object({
  version: z.literal(SETTINGS_VERSION),
  appearance: appearanceSettingsSchema,
  window: windowStateSchema,
  layout: layoutSettingsSchema,
  session: sessionSettingsSchema,
  editing: editingSettingsSchema,
  tools: toolsSettingsSchema,
  ocr: ocrSettingsSchema,
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
  editing: editingSettingsSchema.partial().optional(),
  tools: toolsSettingsSchema.partial().optional(),
  ocr: ocrSettingsSchema.partial().optional(),
});
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

/** Top-level sections, used when repairing a partially valid settings file. */
const SETTINGS_SECTIONS = [
  'appearance',
  'window',
  'layout',
  'session',
  'editing',
  'tools',
  'ocr',
] as const;

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
  editing: { annotationAuthor: '' },
  tools: { qpdfPath: null, tesseractPath: null, tessdataPath: null, libreOfficePath: null },
  ocr: { languages: ['eng'], dpi: 300, preprocess: false },
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
    editing: mergeDefined(current.editing, patch.editing),
    tools: mergeTools(current.tools, patch.tools),
    ocr: mergeDefined(current.ocr, patch.ocr),
  });
}

/**
 * Tool paths are the one setting that can be cleared: passing null means "go
 * back to looking for it", which `mergeDefined` would read as "leave alone".
 */
function mergeTools(
  current: ToolsSettings,
  patch: { [K in keyof ToolsSettings]?: ToolsSettings[K] | undefined } | undefined,
): ToolsSettings {
  if (patch === undefined) return current;

  const merged: ToolsSettings = { ...current };
  for (const key of ['qpdfPath', 'tesseractPath', 'tessdataPath', 'libreOfficePath'] as const) {
    if (key in patch) merged[key] = patch[key] ?? null;
  }
  return merged;
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
