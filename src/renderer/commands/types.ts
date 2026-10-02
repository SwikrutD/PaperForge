import type { LucideIcon } from 'lucide-react';
import type { AppInfo } from '@shared/schemas/appInfo';
import type { DocumentSession } from '@shared/schemas/document';
import type { AnnotationKind } from '@shared/schemas/annotation';
import type { DocumentEditState, SaveMode } from '@shared/schemas/edit';
import type { RecentFileEntry } from '@shared/schemas/recentFiles';
import type {
  LeftPanelId,
  RightPanelId,
  Settings,
  SettingsPatch,
  ThemePreference,
} from '@shared/schemas/settings';
import type { ThemeState } from '@shared/schemas/theme';
import type { ZoomMode } from '../components/viewer/viewerLayout';
import type { DocumentViewState } from '../stores/documentStore';
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
  readonly activeView: DocumentViewState | null;
  /** Unsaved changes and undo history of the active document. */
  readonly activeEdit: DocumentEditState | null;
  /** Pages the active document has, as the viewer counts them. */
  readonly activePageCount: number;
  readonly openDocumentCount: number;
  readonly fullScreen: boolean;
  /** True while the window shows only the document. */
  readonly readingMode: boolean;
  /** True while the comment tools are on show. */
  readonly commenting: boolean;
  /** True while the page grid has taken the workspace. */
  readonly organizing: boolean;
  /** True while the workspace for making a new document has the window. */
  readonly creating: boolean;
  /** True while the text editor is on. */
  readonly editingText: boolean;
  /** The comment tool in use, or null while the select tool is. */
  readonly annotationTool: AnnotationKind | 'eraser' | null;
  /** True when a comment is selected. */
  readonly annotationSelected: boolean;
  /** True while Fill & Sign is on. */
  readonly filling: boolean;
  /** True while the form is being made rather than filled in. */
  readonly preparingForm: boolean;
  /** True while redaction marks are being made. */
  readonly redacting: boolean;
  /** Marks waiting to be applied to the active document. */
  readonly redactionMarkCount: number;
  /** True while the comparison workspace has the window. */
  readonly comparing: boolean;
  /** True while the crop frame is being drawn. */
  readonly cropping: boolean;
  /** True while the Accessibility Check has the properties panel. */
  readonly checkingAccessibility: boolean;
  /** True while the find bar is on screen. */
  readonly findOpen: boolean;
  /** How many matches the current search found. */
  readonly matchCount: number;
  readonly actions: CommandActions;
}

/** The side effects commands are allowed to cause. */
export interface CommandActions {
  openDocuments(): Promise<void>;
  openInNewWindow(): void;
  closeActiveDocument(): Promise<void>;
  closeAllDocuments(): Promise<void>;
  revealActiveDocument(): Promise<void>;
  setZoomMode(mode: ZoomMode): void;
  zoomBy(direction: 1 | -1): void;
  rotateView(direction: 1 | -1): void;
  goToPage(pageNumber: number): void;
  rotateCurrentPage(direction: 1 | -1): void;
  deleteCurrentPage(): void;
  undo(): void;
  redo(): void;
  revert(): void;
  saveDocument(mode: SaveMode): void;
  openFind(options?: { expandOptions?: boolean }): void;
  closeFind(): void;
  findNext(): void;
  findPrevious(): void;
  goToRelativePage(offset: number): void;
  closeWindow(): Promise<void>;
  setThemePreference(preference: ThemePreference): Promise<void>;
  patchSettings(patch: SettingsPatch): Promise<void>;
  setLeftPanel(panel: LeftPanelId): Promise<void>;
  setRightPanel(panel: RightPanelId): Promise<void>;
  toggleFullScreen(): Promise<void>;
  toggleReadingMode(): void;
  toggleCommenting(): void;
  toggleOrganizing(): void;
  toggleTextEditing(): void;
  toggleFilling(): void;
  togglePreparingForm(): void;
  toggleRedacting(): void;
  toggleCropping(): void;
  toggleAccessibility(): void;
  toggleComparing(): void;
  openCreateWorkspace(intent: 'create' | 'combine'): void;
  closeCreateWorkspace(): void;
  setAnnotationTool(tool: AnnotationKind | 'eraser' | 'select'): void;
  deleteSelectedAnnotation(): void;
  toggleSelectedAnnotationResolved(): void;
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
