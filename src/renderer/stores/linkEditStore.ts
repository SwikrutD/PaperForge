import { create } from 'zustand';
import { AppError } from '@shared/errors/appError';
import type { LinkModel, LinkRect, LinkTarget, PageLinksModel } from '@shared/schemas/link';
import { invoke } from '../services/ipcClient';
import { useDocumentStore } from './documentStore';
import { useUiStore } from './uiStore';

/** The links of one page, once they have been read. */
export interface LoadedLinkPage {
  model: PageLinksModel;
  /** The revision they were read from; a later one makes them stale. */
  revision: number;
}

export interface LinkEditStore {
  /** Keyed by `${sessionId}:${page}`. */
  pages: Map<string, LoadedLinkPage>;
  selected: { page: number; id: string } | null;
  /** Where the link being dragged is now, before it is written. */
  drag: { page: number; id: string; rect: LinkRect } | null;
  /** True while the reader is drawing the area a new link covers. */
  drawing: boolean;
  busy: boolean;

  reset: () => void;
  load: (sessionId: string, page: number, revision: number) => Promise<void>;
  select: (page: number, id: string | null) => void;
  setDrag: (drag: { page: number; id: string; rect: LinkRect } | null) => void;
  setDrawing: (drawing: boolean) => void;

  /** Makes a link over an area of a page, pointing at nothing yet useful. */
  create: (page: number, rect: LinkRect) => Promise<void>;
  /** Moves a link, or points it somewhere else, or both. */
  update: (
    page: number,
    id: string,
    change: { rect?: LinkRect; target?: LinkTarget },
  ) => Promise<void>;
  remove: (page: number, id: string) => Promise<void>;
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
 * The link editor's own state: which page's links have been read, which one is
 * selected, and what is being dragged.
 *
 * A new link points at the page it is drawn on until the reader says where it
 * should go: a link has to point somewhere to exist at all, and pointing at
 * the page it is on is the one target that is always true.
 */
export const useLinkEditStore = create<LinkEditStore>((set, get) => ({
  pages: new Map(),
  selected: null,
  drag: null,
  drawing: false,
  busy: false,

  reset: () => set({ selected: null, drag: null, drawing: false }),

  load: async (sessionId, page, revision) => {
    const key = keyOf(sessionId, page);
    const existing = get().pages.get(key);
    if (existing !== undefined && existing.revision === revision) return;

    try {
      const model = await invoke('links:page', { sessionId, page });
      set((state) => {
        const pages = new Map(state.pages);
        pages.set(key, { model, revision: model.revision });
        return { pages };
      });
    } catch (error) {
      report(error);
    }
  },

  select: (page, id) => set({ selected: id === null ? null : { page, id }, drag: null }),
  setDrag: (drag) => set({ drag }),
  setDrawing: (drawing) => set({ drawing, selected: null }),

  create: async (page, rect) => {
    const sessionId = useDocumentStore.getState().activeId;
    if (sessionId === null) return;

    set({ drawing: false });
    await run(sessionId, {
      label: 'Add link',
      operations: [{ kind: 'addLink', page, rect, target: { kind: 'page', page } }],
    });
    await reselect(sessionId, page, rect);
  },

  update: async (page, id, change) => {
    const sessionId = useDocumentStore.getState().activeId;
    if (sessionId === null) return;
    const link = linkOf(get(), sessionId, page, id);
    if (link === undefined) return;

    await run(sessionId, {
      label: change.target === undefined ? 'Move link' : 'Change where a link goes',
      operations: [
        {
          kind: 'updateLink',
          page,
          linkId: id,
          rect: change.rect ?? null,
          target: change.target ?? null,
        },
      ],
    });
    await reselect(sessionId, page, change.rect ?? link.rect);
  },

  remove: async (page, id) => {
    const sessionId = useDocumentStore.getState().activeId;
    if (sessionId === null) return;

    await run(sessionId, {
      label: 'Delete link',
      operations: [{ kind: 'deleteLink', page, linkId: id }],
    });
    set({ selected: null });
  },
}));

async function run(
  sessionId: string,
  transaction: Parameters<ReturnType<typeof useDocumentStore.getState>['applyEdit']>[1],
): Promise<void> {
  useLinkEditStore.setState({ busy: true, drag: null });
  try {
    await useDocumentStore.getState().applyEdit(sessionId, transaction);
  } finally {
    useLinkEditStore.setState({ busy: false });
  }
}

/**
 * Finds the link again after a change, by the area it covers.
 *
 * Pointing a link somewhere else replaces it, so the name it had may be gone;
 * where it sits on the page has not moved.
 */
async function reselect(sessionId: string, page: number, rect: LinkRect): Promise<void> {
  const revision = useDocumentStore.getState().tabs.find((tab) => tab.session.id === sessionId)
    ?.edit.revision;
  if (revision === undefined) return;

  await useLinkEditStore.getState().load(sessionId, page, revision);
  const links = linksFor(useLinkEditStore.getState().pages, sessionId, page);

  const wanted = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  let nearest: { id: string; distance: number } | null = null;
  for (const link of links) {
    const centre = { x: link.rect.x + link.rect.width / 2, y: link.rect.y + link.rect.height / 2 };
    const distance = Math.hypot(centre.x - wanted.x, centre.y - wanted.y);
    if (nearest === null || distance < nearest.distance) nearest = { id: link.id, distance };
  }

  if (nearest !== null && nearest.distance < 1) {
    useLinkEditStore.setState({ selected: { page, id: nearest.id } });
  }
}

function linkOf(
  store: LinkEditStore,
  sessionId: string,
  page: number,
  id: string,
): LinkModel | undefined {
  return store.pages
    .get(keyOf(sessionId, page))
    ?.model.links.find((candidate) => candidate.id === id);
}

/** The links of a page, or none while it is still being read. */
export function linksFor(
  pages: ReadonlyMap<string, LoadedLinkPage>,
  sessionId: string,
  page: number,
): readonly LinkModel[] {
  return pages.get(keyOf(sessionId, page))?.model.links ?? NO_LINKS;
}

/** One frozen empty list, so a page with no links does not re-render forever. */
const NO_LINKS: readonly LinkModel[] = Object.freeze([]);
