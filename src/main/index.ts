import { app, BrowserWindow, session } from 'electron';
import path from 'node:path';
import { APP_NAME, RENDERER_ORIGIN } from '@shared/constants/app';
import { createEventBroadcaster, registerIpcHandlers } from './ipc/registerHandlers';
import { buildContentSecurityPolicy } from './security/csp';
import {
  applyDevSecurityHeaders,
  hardenSession,
  hardenWebContents,
  rejectInsecureCertificates,
} from './security/hardening';
import { DocumentEditor } from './services/documents/documentEditor';
import { DocumentService } from './services/documents/documentService';
import { QpdfService } from './services/qpdf/qpdfService';
import { PdfLibMutationEngine } from '@pdf/mutate/pdfLibEngine';
import { createLogger, parseLogLevel, type Logger } from './services/logging/logger';
import { RecentFilesStore } from './services/recentFiles/recentFilesStore';
import { SessionWorkspaces } from './services/recovery/recoveryJournal';
import { SettingsStore } from './services/settings/settingsStore';
import { ThemeController } from './theme/themeController';
import { registerDocumentProtocol, registerDocumentScheme } from './windows/documentProtocol';
import { createMainWindow } from './windows/mainWindow';
import { registerRendererProtocol, registerRendererScheme } from './windows/rendererProtocol';

const devServerUrl =
  typeof MAIN_WINDOW_VITE_DEV_SERVER_URL === 'string' ? MAIN_WINDOW_VITE_DEV_SERVER_URL : null;
const rendererRoot = path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}`);
const preloadPath = path.join(__dirname, 'preload.js');

app.setName(APP_NAME);
if (process.platform === 'win32') {
  app.setAppUserModelId('com.paperforge.PaperForge');
}
app.enableSandbox();
registerRendererScheme();
registerDocumentScheme();

function installProcessGuards(logger: Logger): void {
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception in the main process.', error);
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection in the main process.', reason);
  });
}

async function bootstrap(): Promise<void> {
  const logger = createLogger({
    directory: app.getPath('logs'),
    level: parseLogLevel(
      process.env['PAPERFORGE_LOG_LEVEL'],
      devServerUrl === null ? 'info' : 'debug',
    ),
  });
  installProcessGuards(logger);
  logger.info(`${APP_NAME} starting.`, `packaged=${String(app.isPackaged)}`);

  const settings = new SettingsStore(app.getPath('userData'), logger);
  await settings.load();
  const theme = new ThemeController(settings.get().appearance.theme);
  const recentFiles = new RecentFilesStore(app.getPath('userData'), logger);
  await recentFiles.load();

  const getWindows = (): BrowserWindow[] => BrowserWindow.getAllWindows();
  const broadcast = createEventBroadcaster({ getWindows, logger });

  const workspaces = new SessionWorkspaces(path.join(app.getPath('temp'), APP_NAME), logger);
  const documents = new DocumentService({
    workspaces,
    recentFiles,
    logger,
    onFileChange: (event) => broadcast('files:changed', event),
    onOpenPathsChanged: (paths) => {
      void settings
        .patch({ session: { openDocuments: paths } })
        .catch((error: unknown) => logger.warn('Could not persist the open documents.', error));
    },
  });

  const qpdf = new QpdfService({
    logger,
    resourcesRoot: app.isPackaged
      ? process.resourcesPath
      : path.join(app.getAppPath(), 'resources'),
    configuredPath: settings.get().tools.qpdfPath,
  });
  const editor = new DocumentEditor({
    documents,
    engine: new PdfLibMutationEngine(),
    qpdf,
    logger,
    workspaceDirectory: (sessionId) => workspaces.directoryFor(sessionId),
    setDirty: (sessionId, dirty) => documents.setDirty(sessionId, dirty),
  });
  // Closing a document throws its working copies away with it.
  documents.onClosed((sessionId) => {
    void editor.dispose(sessionId);
  });
  settings.onChange((next) => {
    qpdf.setConfiguredPath(next.tools.qpdfPath);
  });

  const contentSecurityPolicy = buildContentSecurityPolicy(devServerUrl ?? undefined);
  const trustedOrigins =
    devServerUrl === null ? [RENDERER_ORIGIN] : [RENDERER_ORIGIN, devServerUrl];

  hardenSession(session.defaultSession, logger);
  rejectInsecureCertificates(logger);
  app.on('web-contents-created', (_event, contents) => {
    hardenWebContents(contents, trustedOrigins, logger);
  });

  if (devServerUrl === null) {
    registerRendererProtocol(rendererRoot, contentSecurityPolicy, logger);
  } else {
    applyDevSecurityHeaders(session.defaultSession, contentSecurityPolicy, devServerUrl);
  }
  // The viewer reads the current revision once a document has been changed,
  // and the original file until then.
  registerDocumentProtocol(documents, logger, (sessionId) => editor.currentBytesPath(sessionId));

  const openWindow = (): BrowserWindow =>
    createMainWindow({ settings, theme, logger, preloadPath, devServerUrl });

  registerIpcHandlers({
    settings,
    recentFiles,
    documents,
    editor,
    qpdf,
    workspaces,
    theme,
    logger,
    trustedOrigins,
    getWindows,
    openNewWindow: () => {
      openWindow();
    },
  });

  installShutdownHandler(documents, logger);
  openWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) openWindow();
  });
}

/**
 * Session directories are how a crash is detected, so a normal exit must clear
 * them. Quitting is deferred once while that happens.
 */
function installShutdownHandler(documents: DocumentService, logger: Logger): void {
  let cleanedUp = false;
  app.on('before-quit', (event) => {
    if (cleanedUp) return;
    event.preventDefault();
    void documents
      .closeAll()
      .catch((error: unknown) => logger.warn('Could not clean up document sessions.', error))
      .finally(() => {
        cleanedUp = true;
        app.quit();
      });
  });
}

function main(): void {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  app.on('second-instance', () => {
    const [window] = BrowserWindow.getAllWindows();
    if (window === undefined) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  app.whenReady().then(bootstrap, (error: unknown) => {
    console.error('PaperForge failed to start.', error);
    app.quit();
  });
}

main();
