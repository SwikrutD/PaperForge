import { create } from 'zustand';
import { AppError } from '@shared/errors/appError';
import type {
  DocumentSession,
  FileChangeKind,
  OpenFailure,
  OpenResult,
} from '@shared/schemas/document';
import { invoke, subscribe } from '../services/ipcClient';
import { useUiStore } from './uiStore';

export interface DocumentTab {
  session: DocumentSession;
  /** Set when the file changed underneath us; cleared once acknowledged. */
  externalChange: FileChangeKind | null;
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
    else merged.push({ session, externalChange: null });
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
  };
});
