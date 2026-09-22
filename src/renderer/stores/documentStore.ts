import { create } from 'zustand';
import { AppError, type SerializedAppError } from '@shared/errors/appError';
import type {
  DocumentSession,
  FileChangeKind,
  OpenFailure,
  OpenResult,
} from '@shared/schemas/document';
import type { DocumentEditState, EditTransaction, SaveMode } from '@shared/schemas/edit';
import type { ZoomMode } from '../components/viewer/viewerLayout';
import { invoke, subscribe } from '../services/ipcClient';
import { useUiStore } from './uiStore';

/** Per-tab view state, kept so switching tabs returns you where you were. */
export interface DocumentViewState {
  zoomMode: ZoomMode;
  scale: number;
  rotation: 0 | 90 | 180 | 270;
  pageNumber: number;
  scrollTop: number;
  /** Set by a command; the viewer scrolls there and clears it. */
  pendingPage: number | null;
}

export const DEFAULT_VIEW_STATE: DocumentViewState = {
  zoomMode: 'fitWidth',
  scale: 1,
  rotation: 0,
  pageNumber: 1,
  scrollTop: 0,
  pendingPage: null,
};

/** A document nobody has changed yet. */
export function initialEditState(sessionId: string): DocumentEditState {
  return {
    sessionId,
    revision: 0,
    dirty: false,
    canUndo: false,
    canRedo: false,
    undoLabel: null,
    redoLabel: null,
    savedAt: null,
    historyTrimmed: false,
  };
}

export interface DocumentTab {
  session: DocumentSession;
  /** Set when the file changed underneath us; cleared once acknowledged. */
  externalChange: FileChangeKind | null;
  view: DocumentViewState;
  /** Unsaved changes, undo and redo, as the main process reports them. */
  edit: DocumentEditState;
  /** Pages the viewer found, once the document has been read. */
  pageCount: number;
}

export interface DocumentStore {
  tabs: DocumentTab[];
  activeId: string | null;
  /** True while a file picker or an open is in flight. */
  busy: boolean;
  initialize: () => Promise<void>;
  openWithDialog: () => Promise<void>;
  openPaths: (paths: readonly string[]) => Promise<void>;
  restoreSession: () => Promise<void>;
  close: (sessionId: string) => Promise<void>;
  closeOthers: (sessionId: string) => Promise<void>;
  closeToRight: (sessionId: string) => Promise<void>;
  closeAll: () => Promise<void>;
  activate: (sessionId: string) => void;
  move: (sessionId: string, toIndex: number) => void;
  dismissChange: (sessionId: string) => void;
  updateView: (sessionId: string, patch: Partial<DocumentViewState>) => void;
  /** Recorded by the viewer once it has read the document. */
  setPageCount: (sessionId: string, pageCount: number) => void;
  /** Applies one undoable change to a document. */
  applyEdit: (sessionId: string, transaction: EditTransaction) => Promise<void>;
  undo: (sessionId: string) => Promise<void>;
  redo: (sessionId: string) => Promise<void>;
  revert: (sessionId: string) => Promise<void>;
  save: (sessionId: string, mode: SaveMode) => Promise<void>;
}

let unsubscribe: (() => void) | undefined;

/** Order-preserving insert: a file already open is activated, not duplicated. */
export function mergeSessions(
  tabs: readonly DocumentTab[],
  sessions: readonly DocumentSession[],
): DocumentTab[] {
  const merged = [...tabs];
  for (const session of sessions) {
    const index = merged.findIndex((tab) => tab.session.id === session.id);
    if (index >= 0) merged[index] = { ...merged[index]!, session };
    else {
      merged.push({
        session,
        externalChange: null,
        view: { ...DEFAULT_VIEW_STATE },
        edit: initialEditState(session.id),
        pageCount: 0,
      });
    }
  }
  return merged;
}

/** The tab to activate after one is closed: the next one, else the previous. */
export function nextActiveId(
  tabs: readonly DocumentTab[],
  closedId: string,
  activeId: string | null,
): string | null {
  if (activeId !== closedId) return activeId;
  const index = tabs.findIndex((tab) => tab.session.id === closedId);
  if (index < 0) return activeId;
  const remaining = tabs.filter((tab) => tab.session.id !== closedId);
  if (remaining.length === 0) return null;
  return (remaining[index] ?? remaining[remaining.length - 1])?.session.id ?? null;
}

export function moveTab(
  tabs: readonly DocumentTab[],
  sessionId: string,
  toIndex: number,
): DocumentTab[] {
  const from = tabs.findIndex((tab) => tab.session.id === sessionId);
  if (from < 0) return [...tabs];
  const next = [...tabs];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return [...tabs];
  next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, moved);
  return next;
}

function reportFailures(failures: readonly OpenFailure[]): void {
  const { showToast } = useUiStore.getState();
  for (const failure of failures) {
    showToast({
      title: failure.message,
      description: failure.path,
      intent: 'error',
    });
  }
}

export const useDocumentStore = create<DocumentStore>((set, get) => {
  const applyResult = (result: OpenResult): void => {
    reportFailures(result.failures);
    if (result.sessions.length === 0) return;
    const tabs = mergeSessions(get().tabs, result.sessions);
    const lastOpened = result.sessions[result.sessions.length - 1];
    set({ tabs, activeId: lastOpened?.id ?? get().activeId });
  };

  const runOpen = async (operation: () => Promise<OpenResult>): Promise<void> => {
    set({ busy: true });
    try {
      applyResult(await operation());
    } catch (error) {
      const serialized = AppError.serialize(error);
      useUiStore.getState().showToast({
        title: serialized.message,
        description: serialized.details,
        intent: 'error',
      });
    } finally {
      set({ busy: false });
    }
  };

  /** Puts the edit state on the tab, and keeps the dirty marker in step. */
  const applyEditState = (edit: DocumentEditState): void => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.session.id === edit.sessionId
          ? { ...tab, edit, session: { ...tab.session, dirty: edit.dirty } }
          : tab,
      ),
    }));
  };

  /** Runs an edit request and reports anything that goes wrong in plain words. */
  const runEdit = async (
    operation: () => Promise<DocumentEditState>,
    onError?: (error: SerializedAppError) => boolean,
  ): Promise<void> => {
    try {
      applyEditState(await operation());
    } catch (error) {
      const serialized = AppError.serialize(error);
      if (onError?.(serialized) === true) return;
      useUiStore.getState().showToast({
        title: serialized.message,
        description: serialized.details,
        intent: 'error',
      });
    }
  };

  const closeSession = async (sessionId: string): Promise<void> => {
    await invoke('files:close', { sessionId });
    const tabs = get().tabs;
    set({
      activeId: nextActiveId(tabs, sessionId, get().activeId),
      tabs: tabs.filter((tab) => tab.session.id !== sessionId),
    });
  };

  return {
    tabs: [],
    activeId: null,
    busy: false,

    initialize: async () => {
      unsubscribe?.();
      unsubscribe = subscribe('files:changed', (event) => {
        set((state) => ({
          tabs: state.tabs.map((tab) =>
            tab.session.id === event.sessionId
              ? {
                  ...tab,
                  session: event.file === null ? tab.session : { ...tab.session, file: event.file },
                  externalChange: event.change,
                }
              : tab,
          ),
        }));
      });

      const sessions = await invoke('files:list');
      if (sessions.length > 0) {
        set({ tabs: mergeSessions([], sessions), activeId: sessions[0]?.id ?? null });
      }
    },

    openWithDialog: () => runOpen(() => invoke('files:openDialog')),

    openPaths: (paths) =>
      paths.length === 0
        ? Promise.resolve()
        : runOpen(() => invoke('files:openPaths', { paths: [...paths] })),

    restoreSession: () => runOpen(() => invoke('files:restoreSession')),

    close: async (sessionId) => {
      const tab = get().tabs.find((candidate) => candidate.session.id === sessionId);
      if (tab === undefined) return;

      if (tab.session.dirty) {
        useUiStore.getState().requestConfirmation({
          title: `Close ${tab.session.file.displayName}?`,
          message: 'This document has unsaved changes. Closing it now discards them.',
          confirmLabel: 'Close without saving',
          danger: true,
          onConfirm: () => {
            void closeSession(sessionId);
          },
        });
        return;
      }
      await closeSession(sessionId);
    },

    closeOthers: async (sessionId) => {
      for (const tab of [...get().tabs]) {
        if (tab.session.id !== sessionId) await get().close(tab.session.id);
      }
    },

    closeToRight: async (sessionId) => {
      const tabs = get().tabs;
      const index = tabs.findIndex((tab) => tab.session.id === sessionId);
      if (index < 0) return;
      for (const tab of tabs.slice(index + 1)) await get().close(tab.session.id);
    },

    closeAll: async () => {
      for (const tab of [...get().tabs]) await get().close(tab.session.id);
    },

    activate: (sessionId) => {
      if (get().tabs.some((tab) => tab.session.id === sessionId)) set({ activeId: sessionId });
    },

    move: (sessionId, toIndex) =>
      set((state) => ({ tabs: moveTab(state.tabs, sessionId, toIndex) })),

    dismissChange: (sessionId) =>
      set((state) => ({
        tabs: state.tabs.map((tab) =>
          tab.session.id === sessionId ? { ...tab, externalChange: null } : tab,
        ),
      })),

    updateView: (sessionId, patch) =>
      set((state) => ({
        tabs: state.tabs.map((tab) =>
          tab.session.id === sessionId ? { ...tab, view: { ...tab.view, ...patch } } : tab,
        ),
      })),

    setPageCount: (sessionId, pageCount) =>
      set((state) => ({
        tabs: state.tabs.map((tab) =>
          tab.session.id === sessionId && tab.pageCount !== pageCount ? { ...tab, pageCount } : tab,
        ),
      })),

    applyEdit: (sessionId, transaction) =>
      runEdit(() => invoke('edit:apply', { sessionId, transaction })),

    undo: (sessionId) => runEdit(() => invoke('edit:undo', { sessionId })),
    redo: (sessionId) => runEdit(() => invoke('edit:redo', { sessionId })),
    revert: (sessionId) => runEdit(() => invoke('edit:revert', { sessionId })),

    save: async (sessionId, mode) => {
      const ui = useUiStore.getState();
      const tab = get().tabs.find((candidate) => candidate.session.id === sessionId);
      if (tab === undefined) return;

      const write = async (force: boolean): Promise<void> => {
        const outcome = await invoke('files:save', {
          sessionId,
          mode,
          ...(force ? { force: true } : {}),
        });
        if (outcome.canceled) return;

        if (outcome.session !== null && outcome.edit !== null) {
          const session = outcome.session;
          const edit = outcome.edit;
          set((state) => ({
            tabs: state.tabs.map((candidate) =>
              candidate.session.id === sessionId
                ? { ...candidate, session, edit, externalChange: null }
                : candidate,
            ),
          }));
        }
        ui.showToast({
          title:
            mode === 'saveCopy'
              ? 'A copy was saved.'
              : `${outcome.session?.file.displayName ?? tab.session.file.displayName} was saved.`,
          description: outcome.path ?? undefined,
          intent: 'success',
        });
      };

      try {
        await write(false);
      } catch (error) {
        const serialized = AppError.serialize(error);
        // The one failure the reader can answer: somebody else changed the
        // file since it was opened.
        if (serialized.code === 'io/changed-externally') {
          ui.requestConfirmation({
            title: serialized.message,
            message: 'Saving now replaces what is on disk with your version.',
            confirmLabel: 'Overwrite',
            danger: true,
            onConfirm: () => {
              void write(true).catch((retryError: unknown) => {
                const failure = AppError.serialize(retryError);
                ui.showToast({
                  title: failure.message,
                  description: failure.details,
                  intent: 'error',
                });
              });
            },
          });
          return;
        }
        ui.showToast({
          title: serialized.message,
          description: serialized.details,
          intent: 'error',
        });
      }
    },
  };
});
