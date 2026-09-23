import { create } from 'zustand';
import { AppError } from '@shared/errors/appError';
import {
  DEFAULT_PAGE_SETUP,
  type BlankRequest,
  type CombineEntry,
  type NewDocumentMetadata,
  type PageSetup,
  type SourceFailure,
  type StagedSource,
} from '@shared/schemas/create';
import { parsePageRange } from '@shared/utils/pageRange';
import { invoke } from '../services/ipcClient';
import { useDocumentStore } from './documentStore';
import { useUiStore } from './uiStore';

/** One file in the list, with what the new document takes from it. */
export interface SourceEntry {
  source: StagedSource;
  /** Pages to take, in the notation a print dialog uses. Empty means all. */
  rangeText: string;
  rotation: 0 | 90 | 180 | 270;
}

export interface CreateStore {
  /** True while the workspace for making a document has the window. */
  open: boolean;
  /** What opened it, which is only a matter of what it calls itself. */
  intent: 'create' | 'combine';
  entries: SourceEntry[];
  /** Files that could not be staged, shown until the next change. */
  failures: SourceFailure[];
  /** The paper anything that is not already a PDF is put on. */
  setup: PageSetup;
  metadata: NewDocumentMetadata;
  bookmarkPerSource: boolean;
  keepBookmarks: boolean;
  busy: boolean;

  openWorkspace: (intent: 'create' | 'combine') => void;
  closeWorkspace: () => void;
  addFiles: () => Promise<void>;
  remove: (id: string) => Promise<void>;
  clear: () => Promise<void>;
  move: (id: string, toIndex: number) => void;
  setRange: (id: string, rangeText: string) => void;
  rotate: (id: string, direction: 1 | -1) => void;
  setSetup: (setup: PageSetup) => Promise<void>;
  setMetadata: (patch: Partial<NewDocumentMetadata>) => void;
  setBookmarkPerSource: (value: boolean) => void;
  setKeepBookmarks: (value: boolean) => void;
  /** Writes the new document and opens it; returns true when one was made. */
  combine: () => Promise<boolean>;
  createBlank: (request: BlankRequest) => Promise<boolean>;
}

function report(error: unknown): void {
  const serialized = AppError.serialize(error);
  useUiStore.getState().showToast({
    title: serialized.message,
    description: serialized.details,
    intent: 'error',
  });
}

/** Opens what was just written, so the reader lands in their new document. */
async function openResult(path: string | null): Promise<void> {
  if (path === null) return;
  await useDocumentStore.getState().openPaths([path]);
}

/**
 * The files a new document is being made from.
 *
 * The list is the main process's; this holds the reader's arrangement of it —
 * the order, the pages taken from each file, and how they are turned — and
 * asks for the document to be made when they are ready.
 */
export const useCreateStore = create<CreateStore>((set, get) => ({
  open: false,
  intent: 'create',
  entries: [],
  failures: [],
  setup: DEFAULT_PAGE_SETUP,
  metadata: { title: '', author: '' },
  bookmarkPerSource: true,
  keepBookmarks: true,
  busy: false,

  openWorkspace: (intent) => {
    set({ open: true, intent, failures: [] });
    // The list belongs to the window, so it is still there from last time.
    void invoke('sources:list')
      .then((sources) => {
        set((state) => ({ entries: merge(state.entries, sources) }));
      })
      .catch(report);
  },

  closeWorkspace: () => set({ open: false, failures: [] }),

  addFiles: async () => {
    set({ busy: true, failures: [] });
    try {
      const result = await invoke('sources:add', { setup: get().setup });
      if (result.canceled) return;
      set((state) => ({
        entries: [...state.entries, ...result.sources.map(toEntry)],
        failures: result.failures,
      }));
    } catch (error) {
      report(error);
    } finally {
      set({ busy: false });
    }
  },

  remove: async (id) => {
    try {
      const sources = await invoke('sources:remove', { ids: [id] });
      set((state) => ({ entries: merge(state.entries, sources) }));
    } catch (error) {
      report(error);
    }
  },

  clear: async () => {
    try {
      await invoke('sources:clear');
      set({ entries: [], failures: [] });
    } catch (error) {
      report(error);
    }
  },

  move: (id, toIndex) =>
    set((state) => {
      const from = state.entries.findIndex((entry) => entry.source.id === id);
      if (from < 0) return {};
      const entries = [...state.entries];
      const [moved] = entries.splice(from, 1);
      if (moved === undefined) return {};
      entries.splice(Math.max(0, Math.min(toIndex, entries.length)), 0, moved);
      return { entries };
    }),

  setRange: (id, rangeText) =>
    set((state) => ({
      entries: state.entries.map((entry) =>
        entry.source.id === id ? { ...entry, rangeText } : entry,
      ),
    })),

  rotate: (id, direction) =>
    set((state) => ({
      entries: state.entries.map((entry) =>
        entry.source.id === id ? { ...entry, rotation: turn(entry.rotation, direction) } : entry,
      ),
    })),

  setSetup: async (setup) => {
    const previous = get().setup;
    set({ setup });
    // A PDF is already a PDF; everything else is made into pages again.
    if (!get().entries.some((entry) => entry.source.kind !== 'pdf')) return;

    set({ busy: true });
    try {
      const result = await invoke('sources:setPageSetup', { setup });
      set((state) => ({
        entries: merge(state.entries, result.sources),
        failures: result.failures,
      }));
    } catch (error) {
      set({ setup: previous });
      report(error);
    } finally {
      set({ busy: false });
    }
  },

  setMetadata: (patch) => set((state) => ({ metadata: { ...state.metadata, ...patch } })),
  setBookmarkPerSource: (bookmarkPerSource) => set({ bookmarkPerSource }),
  setKeepBookmarks: (keepBookmarks) => set({ keepBookmarks }),

  combine: async () => {
    const state = get();
    const entries = state.entries.map(toRequestEntry);
    if (entries.length === 0) return false;

    set({ busy: true });
    try {
      const outcome = await invoke('create:combine', {
        entries,
        bookmarkPerSource: state.bookmarkPerSource,
        keepBookmarks: state.keepBookmarks,
        metadata: state.metadata,
      });
      if (outcome.canceled) return false;

      await openResult(outcome.path);
      await invoke('sources:clear').catch(() => undefined);
      set({ open: false, entries: [], failures: [] });
      useUiStore.getState().showToast({
        title: `A document of ${String(outcome.pageCount)} pages was made.`,
        description: outcome.path ?? undefined,
        intent: 'success',
      });
      return true;
    } catch (error) {
      report(error);
      return false;
    } finally {
      set({ busy: false });
    }
  },

  createBlank: async (request) => {
    set({ busy: true });
    try {
      const outcome = await invoke('create:blank', request);
      if (outcome.canceled) return false;

      await openResult(outcome.path);
      set({ open: false });
      useUiStore.getState().showToast({
        title: `A blank document of ${String(outcome.pageCount)} pages was made.`,
        description: outcome.path ?? undefined,
        intent: 'success',
      });
      return true;
    } catch (error) {
      report(error);
      return false;
    } finally {
      set({ busy: false });
    }
  },
}));

function toEntry(source: StagedSource): SourceEntry {
  return { source, rangeText: '', rotation: 0 };
}

/** Keeps the reader's order while taking the main process's list as the truth. */
function merge(entries: readonly SourceEntry[], sources: readonly StagedSource[]): SourceEntry[] {
  const byId = new Map(sources.map((source) => [source.id, source]));
  const kept = entries
    .filter((entry) => byId.has(entry.source.id))
    .map((entry) => ({ ...entry, source: byId.get(entry.source.id) as StagedSource }));

  const known = new Set(kept.map((entry) => entry.source.id));
  return [...kept, ...sources.filter((source) => !known.has(source.id)).map(toEntry)];
}

function turn(rotation: number, direction: 1 | -1): 0 | 90 | 180 | 270 {
  const next = (((rotation + direction * 90) % 360) + 360) % 360;
  return next as 0 | 90 | 180 | 270;
}

/** The pages an entry takes, or null for all of them. */
export function pagesOf(entry: SourceEntry): number[] | null {
  const range = parsePageRange(entry.rangeText, entry.source.pageCount);
  if (range.kind === 'all') return null;
  return range.kind === 'pages' ? range.pages : null;
}

/** Why an entry cannot be used, or null when it is fine. */
export function problemOf(entry: SourceEntry): string | null {
  const range = parsePageRange(entry.rangeText, entry.source.pageCount);
  return range.kind === 'invalid' ? range.message : null;
}

function toRequestEntry(entry: SourceEntry): CombineEntry {
  return { id: entry.source.id, pages: pagesOf(entry), rotation: entry.rotation };
}

/** How many pages the new document will have, as the list stands. */
export function plannedPageCount(entries: readonly SourceEntry[]): number {
  return entries.reduce((total, entry) => {
    const pages = pagesOf(entry);
    return total + (pages === null ? entry.source.pageCount : pages.length);
  }, 0);
}
