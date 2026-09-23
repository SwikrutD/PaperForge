import { create } from 'zustand';
import { AppError } from '@shared/errors/appError';
import type { PageTextModel, TextRunModel } from '@shared/schemas/text';
import { invoke } from '../services/ipcClient';
import { useDocumentStore } from './documentStore';
import { useUiStore } from './uiStore';

/** The text of one page, once it has been read. */
export interface LoadedPage {
  model: PageTextModel;
  /** The revision it was read from; a later one makes it stale. */
  revision: number;
}

export interface TextEditStore {
  /** True while the text editor is on. */
  active: boolean;
  /** Keyed by `${sessionId}:${page}`. */
  pages: Map<string, LoadedPage>;
  /** The run the reader is working on, if any. */
  selected: { page: number; id: string } | null;
  /** The text being typed, while a run is open for editing. */
  draft: string | null;
  busy: boolean;

  setActive: (active: boolean) => void;
  /** Reads a page's text, unless this revision has already been read. */
  load: (sessionId: string, page: number, revision: number) => Promise<void>;
  select: (page: number, id: string | null) => void;
  /** Opens the selected run for typing. */
  beginEdit: (page: number, id: string) => void;
  setDraft: (text: string) => void;
  cancelEdit: () => void;
  /** Writes what was typed, as one undoable change. */
  commitEdit: () => Promise<void>;
}

function keyOf(sessionId: string, page: number): string {
  return `${sessionId}:${String(page)}`;
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
 * The text editor's own state: which page's text has been read, what is
 * selected, and what is being typed.
 *
 * The model belongs to a revision. Every change makes a new one, so a page is
 * read again after each edit rather than being patched in place — the ids of
 * the runs come from the content, and the content has just been rewritten.
 */
export const useTextEditStore = create<TextEditStore>((set, get) => ({
  active: false,
  pages: new Map(),
  selected: null,
  draft: null,
  busy: false,

  setActive: (active) => set({ active, selected: null, draft: null }),

  load: async (sessionId, page, revision) => {
    const key = keyOf(sessionId, page);
    const existing = get().pages.get(key);
    if (existing !== undefined && existing.revision === revision) return;

    try {
      const model = await invoke('text:page', { sessionId, page });
      set((state) => {
        const pages = new Map(state.pages);
        pages.set(key, { model, revision: model.revision });
        return { pages };
      });
    } catch (error) {
      report(error);
    }
  },

  select: (page, id) => set({ selected: id === null ? null : { page, id }, draft: null }),

  beginEdit: (page, id) => {
    const documents = useDocumentStore.getState();
    const sessionId = documents.activeId;
    if (sessionId === null) return;

    const model = get().pages.get(keyOf(sessionId, page))?.model;
    const run = model?.runs.find((candidate) => candidate.id === id);
    if (run === undefined || !run.editable) return;

    set({ selected: { page, id }, draft: run.text });
  },

  setDraft: (draft) => set({ draft }),
  cancelEdit: () => set({ draft: null }),

  commitEdit: async () => {
    const { selected, draft } = get();
    const sessionId = useDocumentStore.getState().activeId;
    if (selected === null || draft === null || sessionId === null) return;

    const model = get().pages.get(keyOf(sessionId, selected.page))?.model;
    const run = model?.runs.find((candidate) => candidate.id === selected.id);
    // Typing nothing new is not a change.
    if (run === undefined || run.text === draft) {
      set({ draft: null });
      return;
    }

    set({ busy: true });
    try {
      await useDocumentStore.getState().applyEdit(sessionId, {
        label: draft === '' ? 'Delete text' : 'Edit text',
        operations: [{ kind: 'editText', page: selected.page, runId: selected.id, text: draft }],
      });
      // The page has been rewritten, so what was selected no longer exists.
      set({ draft: null, selected: null });
    } finally {
      set({ busy: false });
    }
  },
}));

/** The runs of a page, or none while it is still being read. */
export function runsFor(
  pages: ReadonlyMap<string, LoadedPage>,
  sessionId: string,
  page: number,
): readonly TextRunModel[] {
  return pages.get(keyOf(sessionId, page))?.model.runs ?? NO_RUNS;
}

/** One frozen empty list, so a page with no text does not re-render forever. */
const NO_RUNS: readonly TextRunModel[] = Object.freeze([]);
