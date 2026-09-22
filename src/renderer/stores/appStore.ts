import { create } from 'zustand';
import { AppError, type SerializedAppError } from '@shared/errors/appError';
import type { AppInfo } from '@shared/schemas/appInfo';
import type { RecentFileEntry } from '@shared/schemas/recentFiles';
import type { Settings, SettingsPatch, ThemePreference } from '@shared/schemas/settings';
import type { ThemeState } from '@shared/schemas/theme';
import type { WindowRuntimeState } from '@shared/schemas/windowState';
import { invoke, subscribe } from '../services/ipcClient';

export type AppStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface AppStore {
  status: AppStatus;
  settings: Settings | null;
  theme: ThemeState | null;
  appInfo: AppInfo | null;
  recentFiles: RecentFileEntry[];
  windowState: WindowRuntimeState | null;
  error: SerializedAppError | null;
  /** Loads everything the shell needs, then watches for changes. */
  initialize: () => Promise<void>;
  setThemePreference: (preference: ThemePreference) => Promise<void>;
  patchSettings: (patch: SettingsPatch) => Promise<void>;
  clearRecentFiles: () => Promise<void>;
  setRecentFilePinned: (path: string, pinned: boolean) => Promise<void>;
  removeRecentFile: (path: string) => Promise<void>;
  revealInExplorer: (path: string) => Promise<void>;
  toggleFullScreen: () => Promise<void>;
}

let unsubscribers: Array<() => void> = [];

export const useAppStore = create<AppStore>((set, get) => ({
  status: 'idle',
  settings: null,
  theme: null,
  appInfo: null,
  recentFiles: [],
  windowState: null,
  error: null,

  initialize: async () => {
    if (get().status === 'loading' || get().status === 'ready') return;
    set({ status: 'loading', error: null });

    try {
      const [settings, theme, appInfo, recentFiles, windowState] = await Promise.all([
        invoke('settings:get'),
        invoke('theme:getState'),
        invoke('app:getInfo'),
        invoke('recentFiles:list'),
        invoke('window:getState'),
      ]);

      for (const dispose of unsubscribers) dispose();
      unsubscribers = [
        subscribe('theme:changed', (next) => set({ theme: next })),
        subscribe('settings:changed', (next) => set({ settings: next })),
        subscribe('recentFiles:changed', (next) => set({ recentFiles: next })),
        subscribe('window:stateChanged', (next) => set({ windowState: next })),
      ];

      set({ status: 'ready', settings, theme, appInfo, recentFiles, windowState, error: null });
    } catch (error) {
      set({ status: 'error', error: AppError.serialize(error) });
    }
  },

  setThemePreference: async (preference) => {
    const previous = get().settings;
    // Optimistic update keeps the control responsive; the main process is the
    // source of truth and pushes settings:changed / theme:changed right after.
    if (previous !== null) {
      set({ settings: { ...previous, appearance: { ...previous.appearance, theme: preference } } });
    }
    try {
      const settings = await invoke('settings:patch', { appearance: { theme: preference } });
      set({ settings, error: null });
    } catch (error) {
      set({
        error: AppError.serialize(error),
        ...(previous === null ? {} : { settings: previous }),
      });
      throw error;
    }
  },

  patchSettings: async (patch) => {
    const previous = get().settings;
    try {
      const settings = await invoke('settings:patch', patch);
      set({ settings, error: null });
    } catch (error) {
      set({
        error: AppError.serialize(error),
        ...(previous === null ? {} : { settings: previous }),
      });
      throw error;
    }
  },

  clearRecentFiles: async () => {
    set({ recentFiles: await invoke('recentFiles:clear') });
  },

  setRecentFilePinned: async (path, pinned) => {
    set({ recentFiles: await invoke('recentFiles:setPinned', { path, pinned }) });
  },

  removeRecentFile: async (path) => {
    set({ recentFiles: await invoke('recentFiles:remove', { path }) });
  },

  revealInExplorer: async (path) => {
    await invoke('files:revealInExplorer', { path });
  },

  toggleFullScreen: async () => {
    const windowState = await invoke('window:toggleFullScreen');
    set({ windowState });
  },
}));
