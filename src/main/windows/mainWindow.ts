import { BrowserWindow, screen } from 'electron';
import { APP_NAME, RENDERER_ORIGIN } from '@shared/constants/app';
import type { WindowState } from '@shared/schemas/settings';
import type { Logger } from '../services/logging/logger';
import type { SettingsStore } from '../services/settings/settingsStore';
import type { ThemeController } from '../theme/themeController';

/** Painted before the renderer's first frame so startup has no white flash. */
const BACKGROUND_COLOR = { light: '#faf9f8', dark: '#1b1a19' } as const;

const MIN_WIDTH = 880;
const MIN_HEIGHT = 620;
const BOUNDS_SAVE_DELAY_MS = 400;

export interface CreateMainWindowOptions {
  settings: SettingsStore;
  theme: ThemeController;
  logger: Logger;
  preloadPath: string;
  devServerUrl: string | null;
}

/** Restores saved geometry only when it is still visible on a connected display. */
function resolveBounds(state: WindowState): Electron.Rectangle | null {
  if (state.x === undefined || state.y === undefined) return null;
  const candidate = { x: state.x, y: state.y, width: state.width, height: state.height };
  const { workArea } = screen.getDisplayMatching(candidate);
  const horizontallyVisible =
    candidate.x + candidate.width > workArea.x && candidate.x < workArea.x + workArea.width;
  const verticallyVisible =
    candidate.y + candidate.height > workArea.y && candidate.y < workArea.y + workArea.height;
  return horizontallyVisible && verticallyVisible ? candidate : null;
}

export function createMainWindow(options: CreateMainWindowOptions): BrowserWindow {
  const { settings, theme, logger, preloadPath, devServerUrl } = options;
  const state = settings.get().window;
  const bounds = resolveBounds(state);

  const window = new BrowserWindow({
    width: state.width,
    height: state.height,
    ...(bounds === null ? {} : { x: bounds.x, y: bounds.y }),
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    title: APP_NAME,
    show: false,
    backgroundColor: BACKGROUND_COLOR[theme.getState().resolved],
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      spellcheck: false,
      devTools: devServerUrl !== null,
    },
  });

  window.once('ready-to-show', () => {
    if (state.maximized) window.maximize();
    window.show();
    logger.info('Main window ready.');
  });

  attachDiagnostics(window, logger);
  attachBoundsPersistence(window, settings, logger);

  if (devServerUrl !== null) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadURL(`${RENDERER_ORIGIN}/index.html`);
  }

  return window;
}

/**
 * Surfaces renderer failures in the local log. Without this, a blocked script
 * or a bad asset path shows up only as an empty window.
 */
function attachDiagnostics(window: BrowserWindow, logger: Logger): void {
  const contents = window.webContents;

  contents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    logger.error('The renderer failed to load.', validatedURL, `${errorCode} ${errorDescription}`);
  });

  contents.on('render-process-gone', (_event, details) => {
    logger.error('The renderer process ended unexpectedly.', details.reason);
  });

  contents.on('console-message', (event) => {
    if (event.level !== 'error' && event.level !== 'warning') return;
    logger.warn(`Renderer ${event.level}:`, event.message, `${event.sourceId}:${event.lineNumber}`);
  });

  contents.on('preload-error', (_event, preloadPath, error) => {
    logger.error('A preload script failed.', preloadPath, error);
  });
}

function attachBoundsPersistence(
  window: BrowserWindow,
  settings: SettingsStore,
  logger: Logger,
): void {
  let timer: NodeJS.Timeout | undefined;

  const save = (): void => {
    if (window.isDestroyed()) return;
    const maximized = window.isMaximized();
    const { width, height, x, y } = maximized ? window.getNormalBounds() : window.getBounds();
    void settings
      .patch({ window: { width, height, x, y, maximized } })
      .catch((error: unknown) => logger.warn('Could not persist window bounds.', error));
  };

  const schedule = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(save, BOUNDS_SAVE_DELAY_MS);
  };

  window.on('resize', schedule);
  window.on('move', schedule);
  window.on('maximize', schedule);
  window.on('unmaximize', schedule);
  window.on('close', () => {
    if (timer !== undefined) clearTimeout(timer);
    save();
  });
}
