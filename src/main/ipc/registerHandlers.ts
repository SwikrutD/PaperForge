import { BrowserWindow } from 'electron';
import { AppError } from '@shared/errors/appError';
import type { WindowRuntimeState } from '@shared/schemas/windowState';
import { eventContracts, type EventChannel, type EventPayload } from '@shared/ipc/contracts';
import { buildAppInfo } from '../services/appInfo';
import type { DocumentEditor } from '../services/documents/documentEditor';
import type { DocumentService } from '../services/documents/documentService';
import type { QpdfService } from '../services/qpdf/qpdfService';
import type { StagedAssets } from '../services/documents/stagedAssets';
import type { RecentFilesStore } from '../services/recentFiles/recentFilesStore';
import type { SessionWorkspaces } from '../services/recovery/recoveryJournal';
import type { SettingsStore } from '../services/settings/settingsStore';
import type { Logger } from '../services/logging/logger';
import type { ThemeController } from '../theme/themeController';
import type { PageExport } from '../services/documents/pageExport';
import type { DocumentCreator } from '../services/creation/documentCreator';
import type { SourceLibrary } from '../services/creation/sourceLibrary';
import type { ConversionRegistry } from '@conversion/models/provider';
import type { PdfMutationEngine } from '@pdf/mutate/types';
import { registerEditHandlers } from './handlers/editHandlers';
import { registerCreationHandlers } from './handlers/creationHandlers';
import { registerOrganizeHandlers } from './handlers/organizeHandlers';
import { registerTextHandlers } from './handlers/textHandlers';
import { registerImageHandlers } from './handlers/imageHandlers';
import { registerFileHandlers } from './handlers/fileHandlers';
import { createIpcRegistrar } from './registry';

export interface IpcDependencies {
  settings: SettingsStore;
  recentFiles: RecentFilesStore;
  documents: DocumentService;
  editor: DocumentEditor;
  qpdf: QpdfService;
  stagedAssets: StagedAssets;
  pageExport: PageExport;
  engine: PdfMutationEngine;
  library: SourceLibrary;
  creator: DocumentCreator;
  conversions: ConversionRegistry;
  workspaces: SessionWorkspaces;
  theme: ThemeController;
  logger: Logger;
  trustedOrigins: readonly string[];
  /** Windows that should receive pushed events. */
  getWindows: () => BrowserWindow[];
  /** Opens an additional main window. */
  openNewWindow: () => void;
}

/** Sends a contract-validated event to every live renderer. */
export function createEventBroadcaster(deps: Pick<IpcDependencies, 'getWindows' | 'logger'>) {
  return function broadcast<C extends EventChannel>(channel: C, payload: EventPayload<C>): void {
    const validated = eventContracts[channel].safeParse(payload);
    if (!validated.success) {
      deps.logger.error(`Refused to broadcast an invalid ${channel} payload.`);
      return;
    }
    for (const window of deps.getWindows()) {
      if (!window.isDestroyed()) window.webContents.send(channel, validated.data);
    }
  };
}

export function registerIpcHandlers(deps: IpcDependencies): void {
  const registerInvoke = createIpcRegistrar({
    trustedOrigins: deps.trustedOrigins,
    logger: deps.logger,
  });
  const broadcast = createEventBroadcaster(deps);

  registerInvoke('app:getInfo', () => buildAppInfo());
  registerInvoke('settings:get', () => deps.settings.get());
  registerInvoke('settings:patch', async (patch) => {
    const next = await deps.settings.patch(patch);
    if (patch.appearance?.theme !== undefined) {
      deps.theme.setPreference(patch.appearance.theme);
    }
    return next;
  });
  registerInvoke('theme:getState', () => deps.theme.getState());

  registerInvoke('window:getState', (_input, event) => readWindowState(senderWindow(event)));
  registerInvoke('window:toggleFullScreen', (_input, event) => {
    const window = senderWindow(event);
    window.setFullScreen(!window.isFullScreen());
    return readWindowState(window);
  });
  registerInvoke('window:openNew', () => {
    deps.openNewWindow();
  });
  registerInvoke('window:close', (_input, event) => {
    senderWindow(event).close();
  });

  registerEditHandlers(registerInvoke, {
    documents: deps.documents,
    editor: deps.editor,
    qpdf: deps.qpdf,
    stagedAssets: deps.stagedAssets,
    settings: deps.settings,
    senderWindow,
  });

  registerOrganizeHandlers(registerInvoke, {
    documents: deps.documents,
    editor: deps.editor,
    stagedAssets: deps.stagedAssets,
    pageExport: deps.pageExport,
    engine: deps.engine,
    senderWindow,
  });

  registerTextHandlers(registerInvoke, { editor: deps.editor });

  registerImageHandlers(registerInvoke, {
    documents: deps.documents,
    editor: deps.editor,
    stagedAssets: deps.stagedAssets,
    senderWindow,
  });

  registerCreationHandlers(registerInvoke, {
    library: deps.library,
    creator: deps.creator,
    registry: deps.conversions,
    senderWindow,
  });

  registerFileHandlers(registerInvoke, {
    documents: deps.documents,
    recentFiles: deps.recentFiles,
    settings: deps.settings,
    workspaces: deps.workspaces,
    senderWindow,
  });

  deps.theme.onChange((state) => {
    broadcast('theme:changed', state);
  });
  deps.settings.onChange((settings) => {
    broadcast('settings:changed', settings);
  });
  deps.recentFiles.onChange((entries) => {
    broadcast('recentFiles:changed', entries);
  });
}

/** The window that sent a request; every window IPC acts on its own window. */
function senderWindow(event: Electron.IpcMainInvokeEvent): BrowserWindow {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (window === null) {
    throw new AppError('internal/unexpected', {
      message: 'That window is no longer available.',
      details: 'No BrowserWindow for the requesting web contents.',
    });
  }
  return window;
}

export function readWindowState(window: BrowserWindow): WindowRuntimeState {
  return {
    fullScreen: window.isFullScreen(),
    maximized: window.isMaximized(),
    focused: window.isFocused(),
  };
}
