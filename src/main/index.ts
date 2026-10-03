import { app, BrowserWindow, session } from 'electron';
import { existsSync } from 'node:fs';
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
import { DocumentAdmin } from './services/documents/documentAdmin';
import { DocumentRepair } from './services/documents/documentRepair';
import { DocumentOptimizer } from './services/optimize/documentOptimizer';
import { nativeImageCodec } from './services/optimize/nativeImageCodec';
import { DocumentEditor } from './services/documents/documentEditor';
import { DocumentService } from './services/documents/documentService';
import { PageExport } from './services/documents/pageExport';
import { createChromiumPrintDriver } from './services/printing/chromiumPrinter';
import { PrintJobs } from './services/printing/printJobs';
import { DocumentCreator } from './services/creation/documentCreator';
import { SourceLibrary } from './services/creation/sourceLibrary';
import { createHtmlProvider } from './services/conversion/htmlProvider';
import { ConversionRegistry } from '@conversion/models/provider';
import { imageProvider, pdfProvider, textProvider } from '@conversion/providers/localProviders';
import { StagedAssets } from './services/documents/stagedAssets';
import { SignatureLibrary } from './services/signatures/signatureLibrary';
import { TesseractService } from './services/tesseract/tesseractService';
import { ExportSessions } from './services/conversion/exportSession';
import { LibreOfficeProvider } from './services/conversion/libreOffice';
import { QpdfSecurity } from './services/qpdf/qpdfSecurity';
import { QpdfService } from './services/qpdf/qpdfService';
import { PdfLibMutationEngine } from '@pdf/mutate/pdfLibEngine';
import { createLogger, parseLogLevel, type Logger } from './services/logging/logger';
import { RecentFilesStore } from './services/recentFiles/recentFilesStore';
import { SessionWorkspaces } from './services/recovery/recoveryJournal';
import { SessionRecovery } from './services/recovery/sessionRecovery';
import { SettingsStore } from './services/settings/settingsStore';
import { ThemeController } from './theme/themeController';
import { registerDocumentProtocol, registerDocumentScheme } from './windows/documentProtocol';
import { createMainWindow } from './windows/mainWindow';
import { LaunchRouter } from './windows/launchRouting';
import { DesktopIntegration } from './services/windows/desktopIntegration';
import { launchArgsToSkip, parseLaunchArgs } from './services/windows/launchArgs';
import { stableExecutable } from './services/windows/jumpList';
import {
  handleSquirrelEvent,
  pointUninstallIcon,
  readSquirrelEvent,
} from './services/windows/squirrel';
import { registerRendererProtocol, registerRendererScheme } from './windows/rendererProtocol';

const devServerUrl =
  typeof MAIN_WINDOW_VITE_DEV_SERVER_URL === 'string' ? MAIN_WINDOW_VITE_DEV_SERVER_URL : null;
const rendererRoot = path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}`);
const preloadPath = path.join(__dirname, 'preload.js');

/** The identity Squirrel gives an installed copy's shortcuts. */
const SQUIRREL_APP_USER_MODEL_ID = `com.squirrel.${APP_NAME}.${APP_NAME}`;

app.setName(APP_NAME);
if (process.platform === 'win32') {
  // An installed copy uses the identity the installer gave its shortcuts, so
  // the taskbar, the jump list and notifications all agree on which app it is.
  const installed = stableExecutable(process.execPath, existsSync) !== process.execPath;
  app.setAppUserModelId(installed ? SQUIRREL_APP_USER_MODEL_ID : 'com.paperforge.PaperForge');
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

const launches = new LaunchRouter();

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

  const desktop = new DesktopIntegration({
    logger,
    notificationsEnabled: () => settings.get().notifications.whenDone,
  });

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
  const tesseract = new TesseractService({
    logger,
    resourcesRoot: app.isPackaged
      ? process.resourcesPath
      : path.join(app.getAppPath(), 'resources'),
    configuredPath: settings.get().tools.tesseractPath,
    configuredTessdata: settings.get().tools.tessdataPath,
  });
  const exports = new ExportSessions(logger);
  const stagedAssets = new StagedAssets();
  const signatures = new SignatureLibrary(app.getPath('userData'), logger);
  const engine = new PdfLibMutationEngine();
  const pageExport = new PageExport({ engine, qpdf, logger });
  // Pages waiting for the printer live in a folder of their own, cleared of
  // anything an earlier run left behind.
  const printing = new PrintJobs({
    root: path.join(app.getPath('temp'), APP_NAME, 'print'),
    driver: createChromiumPrintDriver(logger),
    logger,
  });
  await printing.clearStale();
  // Everything a new document can be made from. The web-page provider needs
  // Chromium's own printing, so it is registered by the process that has it;
  // local Office conversion joins the list in Segment 13.
  const conversions = new ConversionRegistry();
  conversions.add(pdfProvider);
  conversions.add(imageProvider);
  conversions.add(textProvider);
  conversions.add(createHtmlProvider(logger));

  // Office files convert through a local LibreOffice when there is one; when
  // there is not, the provider says so and the file is refused with a reason.
  const office = new LibreOfficeProvider({
    logger,
    configuredPath: settings.get().tools.libreOfficePath,
  });
  conversions.add(office);

  const library = new SourceLibrary({ registry: conversions, engine, logger });
  const creator = new DocumentCreator({ library, engine, qpdf, logger });

  const editor = new DocumentEditor({
    documents,
    engine,
    qpdf,
    logger,
    workspaceDirectory: (sessionId) => workspaces.directoryFor(sessionId),
    recordState: (sessionId, state) => documents.recordEditState(sessionId, state),
    stagedAssets: (sessionId: string) => stagedAssets.assetsFor(sessionId),
  });
  // Document administration reads the revision the reader is looking at, and
  // writes protected copies through qpdf without touching the open document.
  const admin = new DocumentAdmin({
    engine,
    security: new QpdfSecurity({ qpdf }),
    stagedAssets,
    logger,
    currentBytes: (sessionId) => editor.currentBytes(sessionId),
    workspaceDirectory: (sessionId) => workspaces.directoryFor(sessionId),
  });

  // Repair reads the revision being shown and writes a new file beside it.
  const repair = new DocumentRepair({
    engine,
    qpdf,
    logger,
    currentBytes: (sessionId) => editor.currentBytes(sessionId),
    workspaceDirectory: (sessionId) => workspaces.directoryFor(sessionId),
  });

  // Optimising writes a new revision, so it is undone like any other change.
  const optimizer = new DocumentOptimizer({
    editor,
    engine,
    qpdf,
    codec: nativeImageCodec,
    logger,
    workspaceDirectory: (sessionId) => workspaces.directoryFor(sessionId),
  });

  // Closing a document throws its working copies away with it.
  documents.onClosed((sessionId) => {
    stagedAssets.dispose(sessionId);
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
  registerDocumentProtocol(
    documents,
    logger,
    (sessionId) => editor.currentBytesPath(sessionId),
    (sourceId) => library.bytesOf(sourceId),
  );

  const openWindow = (): BrowserWindow => {
    const window = createMainWindow({ settings, theme, logger, preloadPath, devServerUrl });
    // Files staged for a new document belong to the window that added them.
    const ownerId = window.webContents.id;
    window.on('closed', () => library.clear(ownerId));
    return window;
  };

  registerIpcHandlers({
    settings,
    recentFiles,
    documents,
    editor,
    admin,
    repair,
    optimizer,
    qpdf,
    stagedAssets,
    signatures,
    tesseract,
    exports,
    office,
    pageExport,
    printing,
    desktop,
    engine,
    library,
    creator,
    conversions,
    recovery: new SessionRecovery({ workspaces, documents, editor, logger }),
    theme,
    logger,
    trustedOrigins,
    getWindows,
    openNewWindow: () => {
      openWindow();
    },
  });

  installShutdownHandler(documents, logger);
  launches.attach({ desktop, openWindow });
  desktop.updateJumpList(recentFiles.list());
  recentFiles.onChange((entries) => desktop.updateJumpList(entries));
  openWindow();
  // An installed copy keeps its Apps & features entry showing its own icon.
  if (desktop.supported && desktop.executable !== process.execPath) {
    void pointUninstallIcon(process.execPath).catch((error: unknown) =>
      logger.warn('Could not update the Apps & features entry.', error),
    );
  }

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
  // The installer starts PaperForge to set itself up, and expects it to exit.
  const squirrel =
    app.isPackaged && process.platform === 'win32' ? readSquirrelEvent(process.argv) : null;
  if (squirrel !== null && squirrel !== 'firstrun') {
    void handleSquirrelEvent(squirrel, process.execPath)
      .catch((error: unknown) => console.error('PaperForge setup did not finish.', error))
      .finally(() => app.quit());
    return;
  }

  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  const skip = launchArgsToSkip(process.argv, app.isPackaged);
  launches.receive(parseLaunchArgs(process.argv, { cwd: process.cwd(), skip }), true);

  // A second launch hands its files, or a request for a new window, to this one.
  app.on('second-instance', (_event, argv, workingDirectory) => {
    const request = parseLaunchArgs(argv, {
      cwd: workingDirectory,
      skip: launchArgsToSkip(argv, app.isPackaged),
    });
    launches.receive(request, false);
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
