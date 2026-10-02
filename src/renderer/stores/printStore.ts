import { create } from 'zustand';
import { AppError } from '@shared/errors/appError';
import type { LoadedPdfDocument } from '@pdf/render/types';
import {
  DEFAULT_PRINT_SETTINGS,
  PRINT_QUALITY_DPI,
  type Printer,
  type PrintSettings,
} from '@shared/schemas/print';
import { invoke } from '../services/ipcClient';
import { renderPageForPrint } from '../services/printRender';
import { useJobStore } from './jobStore';
import { useUiStore } from './uiStore';

export interface PrintStore {
  /** Kept between jobs for as long as PaperForge is open. */
  settings: PrintSettings;
  printers: Printer[] | null;
  /** Which page is being prepared, while a job is in flight. */
  progress: { done: number; total: number } | null;
  busy: boolean;

  setSettings: (patch: Partial<PrintSettings>) => void;
  loadPrinters: () => Promise<void>;
  /** Prints the pages; resolves true once they reached the printer. */
  run: (input: {
    sessionId: string;
    document: LoadedPdfDocument;
    pages: readonly number[];
  }) => Promise<boolean>;
  cancel: () => void;
}

function report(error: unknown): void {
  const serialized = AppError.serialize(error);
  useUiStore.getState().showToast({
    title: serialized.message,
    description: serialized.details,
    intent: 'error',
  });
}

/**
 * Printing a document.
 *
 * Like an export, the window draws one page at a time and hands it to the
 * main process, which keeps it on disk until the job is laid out and sent.
 */
export const usePrintStore = create<PrintStore>((set, get) => ({
  settings: DEFAULT_PRINT_SETTINGS,
  printers: null,
  progress: null,
  busy: false,

  setSettings: (patch) => set((state) => ({ settings: { ...state.settings, ...patch } })),

  loadPrinters: async () => {
    try {
      const printers = await invoke('print:printers');
      const chosen = get().settings.deviceName;
      // A printer that has gone away since the last job falls back to the default.
      const stillThere = chosen === null || printers.some((printer) => printer.name === chosen);
      set((state) => ({
        printers,
        settings: stillThere ? state.settings : { ...state.settings, deviceName: null },
      }));
    } catch (error) {
      set({ printers: [] });
      report(error);
    }
  },

  run: async ({ sessionId, document, pages }) => {
    if (pages.length === 0 || get().busy) return false;
    const settings = get().settings;

    const jobs = useJobStore.getState();
    const job = jobs.start(
      {
        type: 'print',
        title: `Printing ${String(pages.length)} page${pages.length === 1 ? '' : 's'}`,
        totalItems: pages.length,
        cancellable: true,
      },
      () => get().cancel(),
    );

    cancelled = false;
    set({ busy: true, progress: { done: 0, total: pages.length } });

    let printId: string | null = null;
    try {
      printId = (await invoke('print:start', { sessionId, settings, pages: pages.length })).printId;

      for (const [index, page] of pages.entries()) {
        if (cancelled) break;
        set({ progress: { done: index, total: pages.length } });
        useJobStore.getState().progress(job, {
          completedItems: index,
          currentItem: `Preparing page ${String(page)}`,
        });

        const picture = await renderPageForPrint(document, page, {
          dpi: PRINT_QUALITY_DPI[settings.quality],
          annotations: settings.annotations,
        });
        if (cancelled) break;
        await invoke('print:page', { printId, ...picture });
      }

      if (cancelled) {
        await invoke('print:cancel', { printId });
        useJobStore.getState().cancel(job);
        return false;
      }

      useJobStore.getState().progress(job, {
        completedItems: pages.length,
        currentItem: 'Sending to the printer',
      });
      const outcome = await invoke('print:finish', { printId });
      if (outcome.printed) useJobStore.getState().succeed(job);
      else useJobStore.getState().cancel(job);
      return outcome.printed;
    } catch (error) {
      useJobStore.getState().fail(job, AppError.serialize(error).message);
      if (printId !== null) await invoke('print:cancel', { printId }).catch(() => undefined);
      report(error);
      return false;
    } finally {
      set({ busy: false, progress: null });
    }
  },

  cancel: () => {
    cancelled = true;
  },
}));

/** Read between pages, so a stop takes effect at once. */
let cancelled = false;
