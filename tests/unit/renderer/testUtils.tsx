import { render, type RenderResult } from '@testing-library/react';
import { vi } from 'vitest';
import type { ReactElement } from 'react';
import { DEFAULT_SETTINGS, type Settings } from '../../../src/shared/schemas/settings';
import type { AppInfo } from '../../../src/shared/schemas/appInfo';
import type { RecentFileEntry } from '../../../src/shared/schemas/recentFiles';
import { CommandProvider } from '../../../src/renderer/commands/CommandProvider';
import { useAppStore } from '../../../src/renderer/stores/appStore';
import { useUiStore } from '../../../src/renderer/stores/uiStore';
import { useJobStore } from '../../../src/renderer/stores/jobStore';
import { EMPTY_RESULTS, useSearchStore } from '../../../src/renderer/stores/searchStore';

export const TEST_APP_INFO: AppInfo = {
  name: 'PaperForge',
  version: '0.1.0',
  isPackaged: false,
  platform: 'win32',
  arch: 'x64',
  locale: 'en-US',
  userName: 'Tester',
  versions: { electron: '44.0.0', chrome: '140.0.0', node: '22.0.0', v8: '14.0' },
  paths: { userData: 'C:/Users/Test/AppData/Roaming/PaperForge', logs: 'C:/logs', temp: 'C:/temp' },
};

export interface SeedOptions {
  settings?: Settings;
  recentFiles?: RecentFileEntry[];
  appInfo?: AppInfo | null;
}

/** Puts the stores into a ready state without touching IPC. */
export function seedStores(options: SeedOptions = {}): void {
  useAppStore.setState({
    status: 'ready',
    settings: options.settings ?? DEFAULT_SETTINGS,
    theme: { preference: options.settings?.appearance.theme ?? 'system', resolved: 'light' },
    appInfo: options.appInfo === undefined ? TEST_APP_INFO : options.appInfo,
    recentFiles: options.recentFiles ?? [],
    windowState: { fullScreen: false, maximized: false, focused: true },
    error: null,
  });
  useUiStore.setState({
    dialog: null,
    commandPaletteOpen: false,
    progressCenterOpen: false,
    readingMode: false,
    toasts: [],
  });
  useJobStore.setState({ jobs: [], cancelHandlers: {} });
  useSearchStore.setState({
    open: false,
    focusRequest: 0,
    query: '',
    options: { caseSensitive: false, wholeWord: false },
    highlightAll: true,
    scope: 'document',
    pageRangeText: '',
    optionsExpanded: false,
    resultsExpanded: false,
    results: EMPTY_RESULTS,
  });
}

/** Renders inside the command provider, the way the real app does. */
export function renderWithCommands(ui: ReactElement, options: SeedOptions = {}): RenderResult {
  seedStores(options);
  return render(<CommandProvider>{ui}</CommandProvider>);
}

/** Minimal preload bridge stub for components that trigger IPC-backed actions. */
export function installBridgeStub(responses: Record<string, unknown> = {}): {
  invoke: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
} {
  const bridge = {
    invoke: vi.fn((channel: string) => Promise.resolve(responses[channel])),
    subscribe: vi.fn(() => () => undefined),
  };
  Object.defineProperty(window, 'paperforge', { value: bridge, configurable: true });
  return bridge;
}
