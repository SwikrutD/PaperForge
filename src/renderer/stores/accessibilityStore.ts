import { create } from 'zustand';
import { AppError } from '@shared/errors/appError';
import type {
  AccessibilityItem,
  AccessibilityReport,
  ReadingOrder,
} from '@shared/schemas/accessibility';
import type { EditOperation } from '@shared/schemas/edit';
import { invoke } from '../services/ipcClient';
import { useDocumentStore } from './documentStore';
import { useUiStore } from './uiStore';

/**
 * The Accessibility Check, as the reader works through it.
 *
 * The report belongs to one revision of one document. A fix is an ordinary
 * undoable edit, and the check runs again on the revision it produced, so the
 * list always describes the document as it now is.
 */

/** An item the reader picked, outlined on its page. */
export interface FocusedItem {
  /** Which item of which check, so the panel can tell it apart from its neighbours. */
  key: string;
  sessionId: string;
  page: number | null;
  rect: AccessibilityItem['rect'];
}

interface AccessibilityState {
  active: boolean;
  report: AccessibilityReport | null;
  reportFor: string | null;
  running: boolean;
  /** Draws the order the tags read each page in. */
  showReadingOrder: boolean;
  /** Reading order by page, for the revision in `orderFor`. */
  orders: Map<number, ReadingOrder>;
  orderFor: { sessionId: string; revision: number } | null;
  focused: FocusedItem | null;

  setActive: (active: boolean) => void;
  setShowReadingOrder: (show: boolean) => void;
  focus: (item: FocusedItem | null) => void;
  /** Runs the check on the revision being shown. */
  run: (sessionId: string) => Promise<void>;
  loadReadingOrder: (sessionId: string, revision: number, page: number) => Promise<void>;
  /** Applies a fix and checks again. True when the fix landed. */
  fix: (sessionId: string, label: string, operations: EditOperation[]) => Promise<boolean>;
}

function report(error: unknown): void {
  const serialized = AppError.serialize(error);
  useUiStore.getState().showToast({
    title: serialized.message,
    description: serialized.details,
    intent: 'error',
  });
}

function revisionOf(sessionId: string): number {
  return (
    useDocumentStore.getState().tabs.find((tab) => tab.session.id === sessionId)?.edit.revision ?? 0
  );
}

/** Reading-order pages loading now, so one page is not asked for twice at once. */
const pendingOrders = new Set<string>();

export const useAccessibilityStore = create<AccessibilityState>((set, get) => ({
  active: false,
  report: null,
  reportFor: null,
  running: false,
  showReadingOrder: false,
  orders: new Map(),
  orderFor: null,
  focused: null,

  setActive: (active) =>
    set(active ? { active } : { active, showReadingOrder: false, focused: null }),
  setShowReadingOrder: (showReadingOrder) => set({ showReadingOrder }),
  focus: (focused) => set({ focused }),

  run: async (sessionId) => {
    set({ running: true });
    try {
      const checked = await invoke('accessibility:check', { sessionId });
      // A later revision may have overtaken this one; the newer check wins.
      if (revisionOf(sessionId) !== checked.revision) return;
      set({ report: checked, reportFor: sessionId });
    } catch (error) {
      report(error);
    } finally {
      set({ running: false });
    }
  },

  loadReadingOrder: async (sessionId, revision, page) => {
    const loaded = get().orderFor;
    const current = loaded?.sessionId === sessionId && loaded.revision === revision;
    if (!current) set({ orders: new Map(), orderFor: { sessionId, revision } });
    if (current && get().orders.has(page)) return;

    const key = `${sessionId}:${String(revision)}:${String(page)}`;
    if (pendingOrders.has(key)) return;
    pendingOrders.add(key);
    try {
      const order = await invoke('accessibility:readingOrder', { sessionId, page });
      const now = get().orderFor;
      if (now?.sessionId !== sessionId || now.revision !== order.revision) return;
      set((state) => ({ orders: new Map(state.orders).set(page, order) }));
    } catch (error) {
      report(error);
    } finally {
      pendingOrders.delete(key);
    }
  },

  fix: async (sessionId, label, operations) => {
    const before = revisionOf(sessionId);
    // The document store reports a failed edit itself.
    await useDocumentStore.getState().applyEdit(sessionId, { label, operations });
    if (revisionOf(sessionId) === before) return false;
    await get().run(sessionId);
    return true;
  },
}));

/** The report for a document, or null when the one held is for another. */
export function reportForSession(
  state: { report: AccessibilityReport | null; reportFor: string | null },
  sessionId: string | null,
): AccessibilityReport | null {
  return sessionId !== null && state.reportFor === sessionId ? state.report : null;
}
