import { create } from 'zustand';
import type { ConfirmationRequest, DialogId, Toast, ToastInput } from '../types/ui';
import { createId } from '../utils/ids';

const DEFAULT_TOAST_MS = 4000;

/**
 * How the pointer acts on the pages when no other tool has them: selecting
 * text and following links, dragging the pages around, or zooming to a
 * rectangle drawn over them.
 */
export type ViewerTool = 'select' | 'hand' | 'marqueeZoom';

export interface Presentation {
  pageNumber: number;
  leaveFullScreen: boolean;
}

export interface UiStore {
  /** Only one modal at a time; the shell is not a stack of dialogs. */
  dialog: DialogId | null;
  commandPaletteOpen: boolean;
  progressCenterOpen: boolean;
  /**
   * True while the window shows only the document: no bars, rail or panels.
   * Deliberately not persisted — it is a way to read, not a preference.
   */
  readingMode: boolean;
  /** True while the comment tools are on show. */
  commenting: boolean;
  viewerTool: ViewerTool;
  /**
   * Set while a document is presented a page at a time over the whole
   * screen: the page on show, and whether presenting put the window into
   * full screen, so stopping takes it out again.
   */
  presentation: Presentation | null;
  toasts: Toast[];
  /**
   * A tool the reader picked before any document was open. It starts once
   * the document they then chose has opened (`PendingToolRunner`).
   */
  toolAfterOpen: string | null;
  /** Pending confirmation, shown over everything else. */
  confirmation: ConfirmationRequest | null;
  openDialog: (dialog: DialogId) => void;
  closeDialog: () => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setProgressCenterOpen: (open: boolean) => void;
  setReadingMode: (readingMode: boolean) => void;
  setCommenting: (commenting: boolean) => void;
  setViewerTool: (tool: ViewerTool) => void;
  setPresentation: (presentation: Presentation | null) => void;
  setPresentationPage: (pageNumber: number) => void;
  setToolAfterOpen: (commandId: string | null) => void;
  showToast: (toast: ToastInput) => string;
  dismissToast: (id: string) => void;
  requestConfirmation: (request: ConfirmationRequest) => void;
  resolveConfirmation: (confirmed: boolean) => void;
}

export const useUiStore = create<UiStore>((set) => ({
  dialog: null,
  commandPaletteOpen: false,
  progressCenterOpen: false,
  readingMode: false,
  commenting: false,
  viewerTool: 'select',
  presentation: null,
  toasts: [],
  toolAfterOpen: null,
  confirmation: null,

  openDialog: (dialog) => set({ dialog, commandPaletteOpen: false }),
  closeDialog: () => set({ dialog: null }),
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  setProgressCenterOpen: (open) => set({ progressCenterOpen: open }),
  setReadingMode: (readingMode) => set({ readingMode }),
  setToolAfterOpen: (toolAfterOpen) => set({ toolAfterOpen }),
  setCommenting: (commenting) => set({ commenting }),
  setViewerTool: (viewerTool) => set({ viewerTool }),
  setPresentation: (presentation) => set({ presentation, commandPaletteOpen: false }),
  setPresentationPage: (pageNumber) =>
    set((state) =>
      state.presentation === null ? {} : { presentation: { ...state.presentation, pageNumber } },
    ),

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

  requestConfirmation: (request) => set({ confirmation: request }),

  resolveConfirmation: (confirmed) => {
    const pending = useUiStore.getState().confirmation;
    set({ confirmation: null });
    if (confirmed) pending?.onConfirm();
  },
}));
