import { app, BrowserWindow, session } from 'electron';
import path from 'node:path';
import { APP_NAME, RENDERER_ORIGIN } from '@shared/constants/app';
import { registerIpcHandlers } from './ipc/registerHandlers';
import { buildContentSecurityPolicy } from './security/csp';
import {
  applyDevSecurityHeaders,
  hardenSession,
  hardenWebContents,
  rejectInsecureCertificates,
} from './security/hardening';
import { createLogger, parseLogLevel, type Logger } from './services/logging/logger';
import { RecentFilesStore } from './services/recentFiles/recentFilesStore';
import { SettingsStore } from './services/settings/settingsStore';
import { ThemeController } from './theme/themeController';
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

  registerIpcHandlers({
    settings,
    recentFiles,
    theme,
    logger,
    trustedOrigins,
    getWindows: () => BrowserWindow.getAllWindows(),
  });

  createMainWindow({ settings, theme, logger, preloadPath, devServerUrl });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow({ settings, theme, logger, preloadPath, devServerUrl });
    }
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
