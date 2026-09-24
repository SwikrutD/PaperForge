import { create } from 'zustand';
import { AppError } from '@shared/errors/appError';
import type { LoadedPdfDocument } from '@pdf/render/types';
import {
  DEFAULT_OCR_OPTIONS,
  type OcrOptions,
  type OcrPageResult,
  type OcrStatus,
} from '@shared/schemas/ocr';
import { invoke } from '../services/ipcClient';
import { useAppStore } from './appStore';
import { useDocumentStore } from './documentStore';
import { useJobStore } from './jobStore';
import { useUiStore } from './uiStore';
import { renderPageForOcr } from '../services/ocrRender';

/** What a finished run came to, for the dialog to report. */
export interface OcrOutcome {
  pages: number;
  words: number;
  /** The average confidence across the pages that had any words. */
  confidence: number | null;
  cancelled: boolean;
  /** The recognised text, when the reader asked for it. */
  text: string;
}

export interface OcrStore {
  status: OcrStatus | null;
  options: OcrOptions;
  /** Which page is being read, while a run is in flight. */
  progress: { page: number; done: number; total: number } | null;
  outcome: OcrOutcome | null;
  busy: boolean;

  forgetOutcome: () => void;
  refreshStatus: () => Promise<void>;
  setOptions: (patch: Partial<OcrOptions>) => void;
  /** Points PaperForge at a Tesseract program, or forgets the one it has. */
  locate: (clear?: boolean) => Promise<void>;
  /** Points PaperForge at a folder of language data, or forgets it. */
  locateLanguages: (clear?: boolean) => Promise<void>;

  /** Reads the chosen pages and puts the words on them. */
  run: (input: {
    sessionId: string;
    document: LoadedPdfDocument;
    pages: readonly number[];
    /** True writes the words into the document; false only reads them out. */
    searchable: boolean;
  }) => Promise<void>;
  cancel: () => void;
  /** Writes the text of the last run to a file the reader chooses. */
  saveText: () => Promise<void>;
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
 * Recognising text: what PaperForge can do, and what it is doing now.
 *
 * The window renders each page and the main process reads it with the local
 * Tesseract binary. Pages are done one at a time, so only one picture is ever
 * in flight and a long document does not eat the machine; every page that has
 * been read is kept, so a cancelled run still leaves the work it finished.
 */
export const useOcrStore = create<OcrStore>((set, get) => ({
  status: null,
  options: DEFAULT_OCR_OPTIONS,
  progress: null,
  outcome: null,
  busy: false,

  /** Forgets the last run, so a dialog opened again starts clean. */
  forgetOutcome: () => set({ outcome: null }),

  refreshStatus: async () => {
    try {
      const status = await invoke('ocr:status');
      const saved = useAppStore.getState().settings?.ocr;
      if (saved !== undefined) set({ options: { ...DEFAULT_OCR_OPTIONS, ...saved } });
      set((state) => ({
        status,
        // Keep to a language this computer actually has.
        options: {
          ...state.options,
          languages: state.options.languages.filter((language) =>
            status.languages.includes(language),
          ),
        },
      }));

      if (get().options.languages.length === 0 && status.languages.length > 0) {
        const preferred = status.languages.includes('eng') ? 'eng' : status.languages[0];
        if (preferred !== undefined) get().setOptions({ languages: [preferred] });
      }
    } catch (error) {
      report(error);
    }
  },

  setOptions: (patch) => {
    const options = { ...get().options, ...patch };
    set({ options });
    // What was chosen here is what PaperForge offers next time.
    void useAppStore
      .getState()
      .patchSettings({ ocr: options })
      .catch(() => undefined);
  },

  locate: async (clear) => {
    try {
      set({ status: await invoke('ocr:locate', clear === true ? { clear: true } : {}) });
      await get().refreshStatus();
    } catch (error) {
      report(error);
    }
  },

  locateLanguages: async (clear) => {
    try {
      set({ status: await invoke('ocr:locateLanguages', clear === true ? { clear: true } : {}) });
      await get().refreshStatus();
    } catch (error) {
      report(error);
    }
  },

  run: async ({ sessionId, document, pages, searchable }) => {
    if (pages.length === 0 || get().busy) return;
    const options = get().options;

    const jobs = useJobStore.getState();
    const job = jobs.start(
      {
        type: 'ocr',
        title: `Recognising text in ${String(pages.length)} page${pages.length === 1 ? '' : 's'}`,
        totalItems: pages.length,
        cancellable: true,
      },
      () => get().cancel(),
    );

    set({
      busy: true,
      outcome: null,
      progress: { page: pages[0] ?? 1, done: 0, total: pages.length },
    });
    cancelled = false;

    const results: OcrPageResult[] = [];
    try {
      for (const [index, page] of pages.entries()) {
        if (cancelled) break;
        set({ progress: { page, done: index, total: pages.length } });
        useJobStore.getState().progress(job, {
          completedItems: index,
          currentItem: `Page ${String(page)} of ${String(pages.length)}`,
        });

        const image = await renderPageForOcr(document, page, options);
        if (cancelled) break;
        results.push(await invoke('ocr:recognisePage', { sessionId, page, image, options }));
      }

      if (results.length > 0 && searchable) {
        await useDocumentStore.getState().applyEdit(sessionId, {
          label:
            results.length === 1
              ? `Recognise text on page ${String(results[0]?.page ?? 1)}`
              : `Recognise text on ${String(results.length)} pages`,
          operations: [{ kind: 'addRecognisedText', pages: results }],
        });
      }

      const scored = results.filter((result) => result.confidence !== null);
      set({
        outcome: {
          pages: results.length,
          words: results.reduce((total, result) => total + result.words.length, 0),
          confidence:
            scored.length === 0
              ? null
              : Math.round(
                  (scored.reduce((total, result) => total + (result.confidence ?? 0), 0) /
                    scored.length) *
                    10,
                ) / 10,
          cancelled,
          text: results.map((result) => result.text).join('\n\n'),
        },
      });

      if (cancelled) useJobStore.getState().cancel(job);
      else useJobStore.getState().succeed(job);
    } catch (error) {
      const serialized = AppError.serialize(error);
      useJobStore.getState().fail(job, serialized.message);
      report(error);
    } finally {
      set({ busy: false, progress: null });
    }
  },

  cancel: () => {
    cancelled = true;
    const sessionId = useDocumentStore.getState().activeId;
    if (sessionId !== null) void invoke('ocr:cancel', { sessionId }).catch(() => undefined);
  },

  saveText: async () => {
    const sessionId = useDocumentStore.getState().activeId;
    const outcome = get().outcome;
    if (sessionId === null || outcome === null || outcome.text.trim() === '') return;

    try {
      const result = await invoke('ocr:writeText', { sessionId, text: outcome.text });
      const written = result.paths[0];
      if (result.canceled || written === undefined) return;
      useUiStore.getState().showToast({
        title: 'The recognised text was saved.',
        description: written,
        intent: 'success',
      });
    } catch (error) {
      report(error);
    }
  },
}));

/**
 * Set when the reader cancels. A module-level flag rather than state, because
 * the loop reads it between pages and must see the change immediately.
 */
let cancelled = false;
