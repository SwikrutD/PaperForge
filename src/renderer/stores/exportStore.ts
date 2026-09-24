import { create } from 'zustand';
import { AppError } from '@shared/errors/appError';
import type { LoadedPdfDocument } from '@pdf/render/types';
import {
  DEFAULT_EXPORT_OPTIONS,
  exportNeedsImage,
  exportNeedsText,
  type ExportOptions,
} from '@shared/schemas/convert';
import { invoke } from '../services/ipcClient';
import { renderPageForExport } from '../services/exportRender';
import { useJobStore } from './jobStore';
import { useUiStore } from './uiStore';

/** What a finished export came to, for the dialog to report. */
export interface ExportOutcome {
  files: number;
  directory: string | null;
  cancelled: boolean;
}

export interface ExportStore {
  options: Omit<ExportOptions, 'pages'>;
  /** Which page is being written, while an export is in flight. */
  progress: { page: number; done: number; total: number } | null;
  outcome: ExportOutcome | null;
  busy: boolean;

  setOptions: (patch: Partial<Omit<ExportOptions, 'pages'>>) => void;
  forgetOutcome: () => void;
  run: (input: {
    sessionId: string;
    document: LoadedPdfDocument;
    pages: readonly number[];
  }) => Promise<void>;
  cancel: () => void;
  /** Opens the folder the export was written to. */
  reveal: () => Promise<void>;
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
 * Exporting a document to something that is not a PDF.
 *
 * The window draws and reads a page at a time and hands each one to the main
 * process, which writes the files. Only one page is ever in flight, so a
 * three-hundred-page document costs no more memory than a one-page one.
 */
export const useExportStore = create<ExportStore>((set, get) => ({
  options: DEFAULT_EXPORT_OPTIONS,
  progress: null,
  outcome: null,
  busy: false,

  setOptions: (patch) => set((state) => ({ options: { ...state.options, ...patch } })),
  forgetOutcome: () => set({ outcome: null }),

  run: async ({ sessionId, document, pages }) => {
    if (pages.length === 0 || get().busy) return;
    const options: ExportOptions = { ...get().options, pages: [...pages] };

    let started: { exportId: string | null };
    try {
      started = await invoke('convert:start', { sessionId, options });
    } catch (error) {
      report(error);
      return;
    }

    const exportId = started.exportId;
    // The reader dismissed the file dialog, which is not a failure.
    if (exportId === null) return;

    const jobs = useJobStore.getState();
    const job = jobs.start(
      {
        type: 'export',
        title: `Exporting ${String(pages.length)} page${pages.length === 1 ? '' : 's'} as ${options.mode.toUpperCase()}`,
        totalItems: pages.length,
        cancellable: true,
      },
      () => get().cancel(),
    );

    cancelled = false;
    set({
      busy: true,
      outcome: null,
      progress: { page: pages[0] ?? 1, done: 0, total: pages.length },
    });

    try {
      for (const [index, page] of pages.entries()) {
        if (cancelled) break;
        set({ progress: { page, done: index, total: pages.length } });
        useJobStore.getState().progress(job, {
          completedItems: index,
          currentItem: `Page ${String(page)} of ${String(pages.length)}`,
        });

        const size = document.pages[page - 1];
        const text = exportNeedsText(options.mode) ? await document.getPageText(page) : null;
        const image = exportNeedsImage(options)
          ? await renderPageForExport(document, page, options)
          : null;
        if (cancelled) break;

        await invoke('convert:page', {
          exportId,
          page,
          width: size?.width ?? 612,
          height: size?.height ?? 792,
          items:
            text?.items.map((item) => ({
              text: item.str,
              x: item.x,
              y: item.y,
              width: item.width,
              height: item.height,
            })) ?? [],
          image,
        });
      }

      const result = cancelled
        ? await invoke('convert:cancel', { exportId })
        : await invoke('convert:finish', { exportId });

      set({
        outcome: {
          files: result.paths.length,
          directory: result.directory,
          cancelled,
        },
      });

      if (cancelled) useJobStore.getState().cancel(job);
      else useJobStore.getState().succeed(job, result.paths[0]);
    } catch (error) {
      useJobStore.getState().fail(job, AppError.serialize(error).message);
      await invoke('convert:cancel', { exportId }).catch(() => undefined);
      report(error);
    } finally {
      set({ busy: false, progress: null });
    }
  },

  cancel: () => {
    cancelled = true;
  },

  reveal: async () => {
    const directory = get().outcome?.directory;
    if (directory === undefined || directory === null) return;
    await invoke('files:revealInExplorer', { path: directory }).catch(() => undefined);
  },
}));

/**
 * Set when the reader stops an export. A module-level flag rather than state,
 * because the loop reads it between pages and must see the change at once.
 */
let cancelled = false;
