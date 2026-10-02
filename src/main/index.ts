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
    setDirty: (sessionId, dirty) => documents.setDirty(sessionId, dirty),
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
    engine,
    library,
    creator,
    conversions,
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
