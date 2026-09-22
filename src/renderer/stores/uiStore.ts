import { create } from 'zustand';
import type { DialogId, Toast, ToastInput } from '../types/ui';
import { createId } from '../utils/ids';

const DEFAULT_TOAST_MS = 4000;

export interface UiStore {
  /** Only one modal at a time; the shell is not a stack of dialogs. */
  dialog: DialogId | null;
  commandPaletteOpen: boolean;
  progressCenterOpen: boolean;
  toasts: Toast[];
  openDialog: (dialog: DialogId) => void;
  closeDialog: () => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setProgressCenterOpen: (open: boolean) => void;
  showToast: (toast: ToastInput) => string;
  dismissToast: (id: string) => void;
}

export const useUiStore = create<UiStore>((set) => ({
  dialog: null,
  commandPaletteOpen: false,
  progressCenterOpen: false,
  toasts: [],

  openDialog: (dialog) => set({ dialog, commandPaletteOpen: false }),
  closeDialog: () => set({ dialog: null }),
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  setProgressCenterOpen: (open) => set({ progressCenterOpen: open }),

  showToast: (input) => {
    const intent = input.intent ?? 'info';
    const toast: Toast = {
      id: createId('toast'),
      title: input.title,
      description: input.description,
      intent,
      // Errors stay until the user dismisses them.
      durationMs: input.durationMs ?? (intent === 'error' ? undefined : DEFAULT_TOAST_MS),
    };
    set((state) => ({ toasts: [...state.toasts, toast] }));
    return toast.id;
  },

  dismissToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}));
