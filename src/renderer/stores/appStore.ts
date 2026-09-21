import { create } from 'zustand';
import { AppError, type SerializedAppError } from '@shared/errors/appError';
import type { AppInfo } from '@shared/schemas/appInfo';
import type { Settings, ThemePreference } from '@shared/schemas/settings';
import type { ThemeState } from '@shared/schemas/theme';
import { invoke, subscribe } from '../services/ipcClient';

export type AppStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface AppStore {
  status: AppStatus;
  settings: Settings | null;
  theme: ThemeState | null;
  appInfo: AppInfo | null;
  error: SerializedAppError | null;
  /** Loads settings, theme and environment info, then watches for changes. */
  initialize: () => Promise<void>;
  setThemePreference: (preference: ThemePreference) => Promise<void>;
}

let unsubscribers: Array<() => void> = [];

export const useAppStore = create<AppStore>((set, get) => ({
  status: 'idle',
  settings: null,
  theme: null,
  appInfo: null,
  error: null,

  initialize: async () => {
    if (get().status === 'loading' || get().status === 'ready') return;
    set({ status: 'loading', error: null });

    try {
      const [settings, theme, appInfo] = await Promise.all([
        invoke('settings:get'),
        invoke('theme:getState'),
        invoke('app:getInfo'),
      ]);

      for (const dispose of unsubscribers) dispose();
      unsubscribers = [
        subscribe('theme:changed', (next) => set({ theme: next })),
        subscribe('settings:changed', (next) => set({ settings: next })),
      ];

      set({ status: 'ready', settings, theme, appInfo, error: null });
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
    }
  },
}));
