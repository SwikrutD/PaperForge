import { create } from 'zustand';
import { AppError } from '@shared/errors/appError';
import type {
  BookmarkList,
  BookmarkNode,
  BookmarkStyle,
  BookmarkTarget,
} from '@shared/schemas/bookmark';
import type { EditOperation } from '@shared/schemas/edit';
import { describeOperation } from '@pdf/mutate/operations';
import { invoke } from '../services/ipcClient';
import { useDocumentStore } from './documentStore';
import { useUiStore } from './uiStore';

/**
 * Editing bookmarks.
 *
 * The outline is read from the revision being shown, and every change is one
 * undoable edit addressed by an entry's position — with its title restated,
 * so a change made against an outline that has since moved is refused rather
 * than applied to the wrong entry.
 */

export type BookmarkMove = 'up' | 'down' | 'indent' | 'outdent';

interface BookmarkState {
  list: BookmarkList | null;
  listFor: string | null;
  selected: string | null;
  /** The entry whose title is being typed. */
  renaming: string | null;

  load: (sessionId: string, revision: number) => Promise<void>;
  select: (path: string | null) => void;
  setRenaming: (path: string | null) => void;
  add: (sessionId: string, target: BookmarkTarget) => Promise<void>;
  rename: (sessionId: string, node: BookmarkNode, title: string) => Promise<void>;
  remove: (sessionId: string, node: BookmarkNode) => Promise<void>;
  move: (sessionId: string, node: BookmarkNode, direction: BookmarkMove) => Promise<void>;
  restyle: (sessionId: string, node: BookmarkNode, style: BookmarkStyle) => Promise<void>;
  retarget: (sessionId: string, node: BookmarkNode, target: BookmarkTarget) => Promise<void>;
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

/** Applies one change; true when it landed. The document store reports a failure. */
async function change(sessionId: string, operation: EditOperation): Promise<boolean> {
  const before = revisionOf(sessionId);
  await useDocumentStore.getState().applyEdit(sessionId, {
    label: describeOperation(operation),
    operations: [operation],
  });
  return revisionOf(sessionId) !== before;
}

export const useBookmarkStore = create<BookmarkState>((set, get) => ({
  list: null,
  listFor: null,
  selected: null,
  renaming: null,

  load: async (sessionId, revision) => {
    const loaded = get().list;
    if (get().listFor === sessionId && loaded?.revision === revision) return;
    try {
      const list = await invoke('bookmarks:list', { sessionId });
      if (revisionOf(sessionId) !== list.revision) return;
      set((state) => ({
        list,
        listFor: sessionId,
        // A selection that is no longer there is dropped.
        selected:
          state.listFor === sessionId && find(list.bookmarks, state.selected) !== null
            ? state.selected
            : null,
      }));
    } catch (error) {
      report(error);
    }
  },

  select: (selected) => set({ selected }),
  setRenaming: (renaming) => set({ renaming }),

  add: async (sessionId, target) => {
    const list = get().list;
    const selected = find(list?.bookmarks ?? [], get().selected);
    // After the selected entry, as its sibling; otherwise at the end.
    const parent = selected === null ? null : parentOf(selected.path);
    const index = selected === null ? (list?.bookmarks.length ?? 0) : indexOf(selected.path) + 1;
    const landed = await change(sessionId, {
      kind: 'addBookmark',
      parent,
      index,
      title: 'Untitled bookmark',
      target,
      style: { bold: false, italic: false, color: null },
    });
    if (landed) {
      const path = childPath(parent, index);
      set({ selected: path, renaming: path });
    }
  },

  rename: async (sessionId, node, title) => {
    set({ renaming: null });
    const trimmed = title.trim();
    if (trimmed === '' || trimmed === node.title) return;
    await change(sessionId, {
      kind: 'updateBookmark',
      path: node.path,
      expectTitle: node.title,
      title: trimmed,
      style: null,
      target: null,
      open: null,
    });
  },

  remove: async (sessionId, node) => {
    const landed = await change(sessionId, {
      kind: 'deleteBookmark',
      path: node.path,
      expectTitle: node.title,
    });
    if (landed) set({ selected: null });
  },

  move: async (sessionId, node, direction) => {
    const plan = planMove(get().list?.bookmarks ?? [], node, direction);
    if (plan === null) return;
    const landed = await change(sessionId, {
      kind: 'moveBookmark',
      path: node.path,
      expectTitle: node.title,
      parent: plan.parent,
      index: plan.index,
    });
    if (landed) set({ selected: plan.after });
  },

  restyle: async (sessionId, node, style) => {
    await change(sessionId, {
      kind: 'updateBookmark',
      path: node.path,
      expectTitle: node.title,
      title: null,
      style,
      target: null,
      open: null,
    });
  },

  retarget: async (sessionId, node, target) => {
    await change(sessionId, {
      kind: 'updateBookmark',
      path: node.path,
      expectTitle: node.title,
      title: null,
      style: null,
      target,
      open: null,
    });
  },
}));

// ------------------------------------------------------------- positions ---

export function find(nodes: readonly BookmarkNode[], path: string | null): BookmarkNode | null {
  if (path === null) return null;
  for (const node of nodes) {
    if (node.path === path) return node;
    if (path.startsWith(`${node.path}.`)) return find(node.children, path);
  }
  return null;
}

export function parentOf(path: string): string | null {
  const cut = path.lastIndexOf('.');
  return cut < 0 ? null : path.slice(0, cut);
}

export function indexOf(path: string): number {
  return Number.parseInt(path.slice(path.lastIndexOf('.') + 1), 10);
}

function childPath(parent: string | null, index: number): string {
  return parent === null ? String(index) : `${parent}.${String(index)}`;
}

function siblingsOf(nodes: readonly BookmarkNode[], path: string): readonly BookmarkNode[] {
  const parent = parentOf(path);
  return parent === null ? nodes : (find(nodes, parent)?.children ?? []);
}

/**
 * Where a move sends an entry: the operation's parent and index (read before
 * the move) and the entry's position afterwards. Null when it cannot go that
 * way — the first entry cannot move up, a top-level one cannot move out.
 */
export function planMove(
  nodes: readonly BookmarkNode[],
  node: BookmarkNode,
  direction: BookmarkMove,
): { parent: string | null; index: number; after: string } | null {
  const parent = parentOf(node.path);
  const index = indexOf(node.path);
  const siblings = siblingsOf(nodes, node.path);

  switch (direction) {
    case 'up':
      return index === 0 ? null : { parent, index: index - 1, after: childPath(parent, index - 1) };
    case 'down':
      return index >= siblings.length - 1
        ? null
        : { parent, index: index + 2, after: childPath(parent, index + 1) };
    case 'indent': {
      const previous = siblings[index - 1];
      if (previous === undefined) return null;
      return {
        parent: previous.path,
        index: previous.children.length,
        after: childPath(previous.path, previous.children.length),
      };
    }
    case 'outdent': {
      if (parent === null) return null;
      const grandparent = parentOf(parent);
      const slot = indexOf(parent) + 1;
      return { parent: grandparent, index: slot, after: childPath(grandparent, slot) };
    }
  }
}
