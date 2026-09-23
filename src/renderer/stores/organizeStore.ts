import { create } from 'zustand';
import { AppError } from '@shared/errors/appError';
import type { EditOperation } from '@shared/schemas/edit';
import type { PageBoxes, PageLabelStyle, PageSource, SplitPart } from '@shared/schemas/pages';
import { invoke } from '../services/ipcClient';
import { useDocumentStore } from './documentStore';
import { useUiStore } from './uiStore';
import {
  EMPTY_SELECTION,
  selectAll,
  selectPage,
  selectionAfterRemoval,
  type SelectionModifier,
  type SelectionState,
} from '../components/organize/organizeSelection';

/** The dialog the organize workspace has open, if any. */
export type OrganizeDialog = 'extract' | 'split' | 'crop' | 'labels' | null;

interface OrganizeStore {
  /** True while the page grid has taken the workspace. */
  active: boolean;
  selection: SelectionState;
  /** What each page says about its own geometry, read when the grid opens. */
  boxes: PageBoxes[];
  loadedFor: { sessionId: string; revision: number } | null;
  dialog: OrganizeDialog;
  busy: boolean;

  setActive: (active: boolean) => void;
  choose: (pageNumber: number, modifier: SelectionModifier) => void;
  chooseAll: (pageCount: number) => void;
  setSelection: (selection: SelectionState) => void;
  clearSelection: () => void;
  openDialog: (dialog: OrganizeDialog) => void;

  /** Reads the page boxes of a document revision, once. */
  loadBoxes: (sessionId: string, revision: number) => Promise<void>;

  /** Applies page operations as one undoable step. */
  apply: (label: string, operations: EditOperation[]) => Promise<void>;
  /** Removes pages and leaves the selection somewhere sensible. */
  deletePages: (pages: readonly number[], pageCount: number) => Promise<void>;

  /** Picks another PDF or an image to take pages from; null when cancelled. */
  chooseSource: (kind: 'pdf' | 'image') => Promise<PageSource | null>;
  /** Stages one open document's pages for use in another. */
  stageDocument: (intoSessionId: string, fromSessionId: string) => Promise<PageSource | null>;
  /**
   * Moves the chosen pages into another open document: they are added there and
   * removed here, each document keeping its own undo history.
   */
  moveToDocument: (
    targetSessionId: string,
    pages: readonly number[],
    pageCount: number,
  ) => Promise<void>;
  /** Writes pages out; returns how many files were written. */
  exportPages: (parts: SplitPart[], mode: 'single' | 'perPage') => Promise<number>;
  /** Renumbers pages from one page onwards. */
  setLabels: (
    fromPage: number,
    style: PageLabelStyle,
    prefix: string,
    start: number,
  ) => Promise<void>;
}

function activeSessionId(): string | null {
  return useDocumentStore.getState().activeId;
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
 * The page grid's own state: which pages are chosen, what they are, and the
 * requests the grid makes.
 *
 * The pages themselves belong to the document, so nothing here is a copy of
 * them — the boxes are re-read whenever the revision moves, and every change
 * goes through the same undoable pipeline as any other edit.
 */
export const useOrganizeStore = create<OrganizeStore>((set, get) => ({
  active: false,
  selection: EMPTY_SELECTION,
  boxes: [],
  loadedFor: null,
  dialog: null,
  busy: false,

  setActive: (active) =>
    set({ active, selection: EMPTY_SELECTION, dialog: null, ...(active ? {} : { boxes: [] }) }),
  choose: (pageNumber, modifier) =>
    set((state) => ({ selection: selectPage(state.selection, pageNumber, modifier) })),
  chooseAll: (pageCount) => set({ selection: selectAll(pageCount) }),
  setSelection: (selection) => set({ selection }),
  clearSelection: () => set({ selection: EMPTY_SELECTION }),
  openDialog: (dialog) => set({ dialog }),

  loadBoxes: async (sessionId, revision) => {
    const loaded = get().loadedFor;
    if (loaded?.sessionId === sessionId && loaded.revision === revision) return;

    try {
      const boxes = await invoke('pages:boxes', { sessionId });
      const tab = useDocumentStore
        .getState()
        .tabs.find((candidate) => candidate.session.id === sessionId);
      // A later revision may have overtaken this request.
      if (tab?.edit.revision !== revision) return;
      set({ boxes, loadedFor: { sessionId, revision } });
    } catch (error) {
      report(error);
      set({ boxes: [], loadedFor: { sessionId, revision } });
    }
  },

  apply: async (label, operations) => {
    const sessionId = activeSessionId();
    if (sessionId === null || operations.length === 0) return;

    set({ busy: true });
    try {
      await useDocumentStore.getState().applyEdit(sessionId, { label, operations });
    } finally {
      set({ busy: false });
    }
  },

  deletePages: async (pages, pageCount) => {
    if (pages.length === 0) return;
    await get().apply('Delete pages', [{ kind: 'deletePages', pages: [...pages] }]);
    set({ selection: selectionAfterRemoval(pages, pageCount) });
  },

  chooseSource: async (kind) => {
    const sessionId = activeSessionId();
    if (sessionId === null) return null;
    try {
      return kind === 'pdf'
        ? await invoke('pages:choosePdfSource', { sessionId })
        : await invoke('pages:chooseImageSource', { sessionId });
    } catch (error) {
      report(error);
      return null;
    }
  },

  stageDocument: async (intoSessionId, fromSessionId) => {
    try {
      return await invoke('pages:stageOpenDocument', {
        sessionId: intoSessionId,
        fromSessionId,
      });
    } catch (error) {
      report(error);
      return null;
    }
  },

  moveToDocument: async (targetSessionId, pages, pageCount) => {
    const sessionId = activeSessionId();
    if (sessionId === null || pages.length === 0) return;

    const documents = useDocumentStore.getState();
    const target = documents.tabs.find((tab) => tab.session.id === targetSessionId);
    if (target === undefined) return;

    set({ busy: true });
    try {
      const source = await get().stageDocument(targetSessionId, sessionId);
      if (source === null || source.kind !== 'pdf') return;

      // The pages arrive at the end of the other document, then leave this one.
      // Two transactions, because undo belongs to the document it changed.
      await documents.applyEdit(targetSessionId, {
        label: `Insert ${String(pages.length)} page${pages.length === 1 ? '' : 's'}`,
        operations: [
          {
            kind: 'insertPages',
            atIndex: Math.max(0, target.pageCount),
            token: source.token,
            pages: [...pages],
          },
        ],
      });
      await documents.applyEdit(sessionId, {
        label: 'Move pages to another document',
        operations: [{ kind: 'deletePages', pages: [...pages] }],
      });
      set({ selection: selectionAfterRemoval(pages, pageCount) });

      useUiStore.getState().showToast({
        title: `${String(pages.length)} page${pages.length === 1 ? '' : 's'} moved to ${target.session.file.displayName}.`,
        intent: 'success',
      });
    } finally {
      set({ busy: false });
    }
  },

  exportPages: async (parts, mode) => {
    const sessionId = activeSessionId();
    if (sessionId === null) return 0;

    set({ busy: true });
    try {
      const result = await invoke('pages:extract', { sessionId, parts, mode });
      if (result.canceled) return 0;

      useUiStore.getState().showToast({
        title:
          result.paths.length === 1
            ? 'The pages were written to a new document.'
            : `${String(result.paths.length)} documents were written.`,
        description: result.directory ?? undefined,
        intent: 'success',
      });
      return result.paths.length;
    } catch (error) {
      report(error);
      return 0;
    } finally {
      set({ busy: false });
    }
  },

  setLabels: async (fromPage, style, prefix, start) => {
    await get().apply('Change page numbering', [
      { kind: 'setPageLabels', fromPage, style, prefix, start },
    ]);
  },
}));

/** The boxes of one page, when they have been read. */
export function boxesForPage(
  boxes: readonly PageBoxes[],
  pageNumber: number,
): PageBoxes | undefined {
  return boxes.find((entry) => entry.pageNumber === pageNumber);
}
