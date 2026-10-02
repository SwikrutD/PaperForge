import { BrowserWindow } from 'electron';
import { AppError } from '@shared/errors/appError';
import type { WindowRuntimeState } from '@shared/schemas/windowState';
import { eventContracts, type EventChannel, type EventPayload } from '@shared/ipc/contracts';
import { buildAppInfo } from '../services/appInfo';
import type { DocumentAdmin } from '../services/documents/documentAdmin';
import type { DocumentEditor } from '../services/documents/documentEditor';
import type { DocumentRepair } from '../services/documents/documentRepair';
import type { DocumentOptimizer } from '../services/optimize/documentOptimizer';
import type { DocumentService } from '../services/documents/documentService';
import type { QpdfService } from '../services/qpdf/qpdfService';
import type { StagedAssets } from '../services/documents/stagedAssets';
import type { SignatureLibrary } from '../services/signatures/signatureLibrary';
import type { TesseractService } from '../services/tesseract/tesseractService';
import type { ExportSessions } from '../services/conversion/exportSession';
import type { LibreOfficeProvider } from '../services/conversion/libreOffice';
import type { RecentFilesStore } from '../services/recentFiles/recentFilesStore';
import type { SessionWorkspaces } from '../services/recovery/recoveryJournal';
import type { SettingsStore } from '../services/settings/settingsStore';
import type { Logger } from '../services/logging/logger';
import type { ThemeController } from '../theme/themeController';
import type { PageExport } from '../services/documents/pageExport';
import type { PrintJobs } from '../services/printing/printJobs';
import type { DesktopIntegration } from '../services/windows/desktopIntegration';
import type { DocumentCreator } from '../services/creation/documentCreator';
import type { SourceLibrary } from '../services/creation/sourceLibrary';
import type { ConversionRegistry } from '@conversion/models/provider';
import type { PdfMutationEngine } from '@pdf/mutate/types';
import { registerAdminHandlers } from './handlers/adminHandlers';
import { registerEditHandlers } from './handlers/editHandlers';
import { registerCreationHandlers } from './handlers/creationHandlers';
import { registerOrganizeHandlers } from './handlers/organizeHandlers';
import { registerTextHandlers } from './handlers/textHandlers';
import { registerRedactionHandlers } from './handlers/redactionHandlers';
import { registerRepairHandlers } from './handlers/repairHandlers';
import { registerImageHandlers } from './handlers/imageHandlers';
import { registerLinkHandlers } from './handlers/linkHandlers';
import { registerFormHandlers } from './handlers/formHandlers';
import { registerStructureHandlers } from './handlers/structureHandlers';
import { registerSignatureHandlers } from './handlers/signatureHandlers';
import { registerOcrHandlers } from './handlers/ocrHandlers';
import { registerConvertHandlers } from './handlers/convertHandlers';
import { registerFileHandlers } from './handlers/fileHandlers';
import { registerPrintHandlers } from './handlers/printHandlers';
import { registerSystemHandlers } from './handlers/systemHandlers';
import { createIpcRegistrar } from './registry';

export interface IpcDependencies {
  settings: SettingsStore;
  recentFiles: RecentFilesStore;
  documents: DocumentService;
  editor: DocumentEditor;
  admin: DocumentAdmin;
  repair: DocumentRepair;
  optimizer: DocumentOptimizer;
  qpdf: QpdfService;
  stagedAssets: StagedAssets;
  signatures: SignatureLibrary;
  tesseract: TesseractService;
  exports: ExportSessions;
  office: LibreOfficeProvider;
  pageExport: PageExport;
  printing: PrintJobs;
  desktop: DesktopIntegration;
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

  registerAdminHandlers(registerInvoke, {
    documents: deps.documents,
    admin: deps.admin,
    senderWindow,
  });

  registerRepairHandlers(registerInvoke, {
    documents: deps.documents,
    repair: deps.repair,
    senderWindow,
  });

  registerInvoke('optimize:analyze', ({ sessionId }) => deps.optimizer.analyze(sessionId));
  registerInvoke('optimize:run', ({ sessionId, settings }) =>
    deps.optimizer.optimize(sessionId, settings),
  );

  registerTextHandlers(registerInvoke, { editor: deps.editor });

  registerRedactionHandlers(registerInvoke, {
    editor: deps.editor,
    engine: deps.engine,
    stagedAssets: deps.stagedAssets,
  });

  registerImageHandlers(registerInvoke, {
    documents: deps.documents,
    editor: deps.editor,
    stagedAssets: deps.stagedAssets,
    senderWindow,
  });

  registerLinkHandlers(registerInvoke, { editor: deps.editor });

  registerFormHandlers(registerInvoke, { editor: deps.editor });

  registerStructureHandlers(registerInvoke, { editor: deps.editor, engine: deps.engine });

  registerSignatureHandlers(registerInvoke, {
    signatures: deps.signatures,
    stagedAssets: deps.stagedAssets,
  });

  registerOcrHandlers(registerInvoke, {
    documents: deps.documents,
    settings: deps.settings,
    tesseract: deps.tesseract,
    senderWindow,
  });

  registerConvertHandlers(registerInvoke, {
    documents: deps.documents,
    exports: deps.exports,
    office: deps.office,
    settings: deps.settings,
    senderWindow,
  });

  registerCreationHandlers(registerInvoke, {
    library: deps.library,
    creator: deps.creator,
    registry: deps.conversions,
    senderWindow,
  });

  registerPrintHandlers(registerInvoke, { documents: deps.documents, printing: deps.printing });
  registerSystemHandlers(registerInvoke, {
    documents: deps.documents,
    desktop: deps.desktop,
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
