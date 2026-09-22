import type { LucideIcon } from 'lucide-react';
import type { AppInfo } from '@shared/schemas/appInfo';
import type { DocumentSession } from '@shared/schemas/document';
import type { RecentFileEntry } from '@shared/schemas/recentFiles';
import type {
  LeftPanelId,
  RightPanelId,
  Settings,
  SettingsPatch,
  ThemePreference,
} from '@shared/schemas/settings';
import type { ThemeState } from '@shared/schemas/theme';
import type { DialogId, ToastInput } from '../types/ui';

export type CommandCategory = 'file' | 'edit' | 'view' | 'tools' | 'window' | 'help';

/** Everything a command may act on. Built fresh from the stores on each read. */
export interface CommandContext {
  readonly settings: Settings;
  readonly theme: ThemeState | null;
  readonly appInfo: AppInfo | null;
  readonly recentFiles: readonly RecentFileEntry[];
  /** The document the workspace is showing, if any. */
  readonly activeDocument: DocumentSession | null;
  readonly openDocumentCount: number;
  readonly fullScreen: boolean;
  readonly actions: CommandActions;
}

/** The side effects commands are allowed to cause. */
export interface CommandActions {
  openDocuments(): Promise<void>;
  openInNewWindow(): void;
  closeActiveDocument(): Promise<void>;
  closeAllDocuments(): Promise<void>;
  revealActiveDocument(): Promise<void>;
  closeWindow(): Promise<void>;
  setThemePreference(preference: ThemePreference): Promise<void>;
  patchSettings(patch: SettingsPatch): Promise<void>;
  setLeftPanel(panel: LeftPanelId): Promise<void>;
  setRightPanel(panel: RightPanelId): Promise<void>;
  toggleFullScreen(): Promise<void>;
  clearRecentFiles(): Promise<void>;
  openDialog(dialog: DialogId): void;
  closeDialog(): void;
  setCommandPaletteOpen(open: boolean): void;
  toggleProgressCenter(): void;
  showToast(toast: ToastInput): void;
  focusNextRegion(): void;
  copyDiagnostics(): Promise<void>;
}

export interface CommandAvailability {
  enabled: boolean;
  /** Why the command cannot run right now; surfaced as a tooltip. */
  reason?: string;
}

export interface CommandDefinition {
  id: string;
  title: string;
  description?: string;
  category: CommandCategory;
  /** Groups items within a menu, rendered with separators between groups. */
  group?: string;
  icon?: LucideIcon;
  /** Human-readable chord, e.g. "Ctrl+K". Parsed by the shortcut service. */
  shortcut?: string;
  /** Extra words the command palette should match on. */
  keywords?: readonly string[];
  /** Omitted means always available. */
  isAvailable?: (context: CommandContext) => boolean | CommandAvailability;
  /** For toggles and radio-style commands. */
  isChecked?: (context: CommandContext) => boolean;
  /** Keeps internal commands out of the palette. */
  hiddenInPalette?: boolean;
  run: (context: CommandContext) => void | Promise<void>;
}

export interface ResolvedCommand {
  definition: CommandDefinition;
  enabled: boolean;
  reason: string | undefined;
  checked: boolean;
}
