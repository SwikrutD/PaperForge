import { create } from 'zustand';
import { AppError } from '@shared/errors/appError';
import type { PageBoxes, PageBoxRect } from '@shared/schemas/pages';
import {
  ZERO_MARGINS,
  cropOperations,
  marginsFit,
  marginsOf,
  visibleBox,
  type CropMargins,
} from '@shared/utils/cropBoxes';
import { parsePageRange } from '@shared/utils/pageRange';
import { invoke } from '../services/ipcClient';
import { useDocumentStore } from './documentStore';
import { useUiStore } from './uiStore';

/**
 * The crop tool on the page.
 *
 * The reader draws a frame on one page; the frame is turned into margins
 * measured from what that page shows, and the margins are what is applied —
 * to that page, every page, or a range. Nothing changes until Apply, which
 * is one undoable edit like any other.
 */

export type CropScope = 'page' | 'all' | 'range';

export interface CropFrame {
  sessionId: string;
  page: number;
  /** In PDF user space, on the page it was drawn on. */
  rect: PageBoxRect;
}

interface CropState {
  active: boolean;
  frame: CropFrame | null;
  /** What each page says about its own geometry, for the revision shown. */
  boxes: PageBoxes[];
  loadedFor: { sessionId: string; revision: number } | null;
  scope: CropScope;
  rangeText: string;
  /** Changes the page itself, not just what it shows. */
  resizePage: boolean;

  setActive: (active: boolean) => void;
  setFrame: (frame: CropFrame | null) => void;
  setScope: (scope: CropScope) => void;
  setRangeText: (text: string) => void;
  setResizePage: (resize: boolean) => void;
  loadBoxes: (sessionId: string, revision: number) => Promise<void>;
  /** Applies the frame's margins to the pages in scope. True when applied. */
  apply: (sessionId: string, pageCount: number) => Promise<boolean>;
  /** Takes the crop off the pages in scope, so each shows its whole page again. */
  reset: (sessionId: string, pageCount: number) => Promise<boolean>;
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

function describeCount(count: number): string {
  return `${String(count)} page${count === 1 ? '' : 's'}`;
}

/** The pages a crop applies to, or why there are none. */
export function pagesInScope(
  scope: CropScope,
  rangeText: string,
  framePage: number | null,
  pageCount: number,
): { pages: number[] } | { problem: string } {
  if (scope === 'page') {
    return framePage === null
      ? { problem: 'Draw a frame on a page first.' }
      : { pages: [framePage] };
  }
  if (scope === 'all') return { pages: Array.from({ length: pageCount }, (_, index) => index + 1) };

  const range = parsePageRange(rangeText, pageCount);
  if (range.kind === 'invalid') return { problem: range.message };
  if (range.kind === 'all') {
    return { pages: Array.from({ length: pageCount }, (_, index) => index + 1) };
  }
  return { pages: range.pages };
}

/** The frame's margins, measured from what its own page shows. */
export function frameMargins(
  frame: CropFrame | null,
  boxes: readonly PageBoxes[],
): CropMargins | null {
  if (frame === null) return null;
  const entry = boxes.find((candidate) => candidate.pageNumber === frame.page);
  if (entry === undefined) return null;
  return marginsOf(frame.rect, visibleBox(entry));
}

export const useCropStore = create<CropState>((set, get) => ({
  active: false,
  frame: null,
  boxes: [],
  loadedFor: null,
  scope: 'page',
  rangeText: '',
  resizePage: false,

  setActive: (active) =>
    set(active ? { active } : { active, frame: null, resizePage: false, loadedFor: null }),
  setFrame: (frame) => set({ frame }),
  setScope: (scope) => set({ scope }),
  setRangeText: (rangeText) => set({ rangeText, scope: 'range' }),
  setResizePage: (resizePage) => set({ resizePage }),

  loadBoxes: async (sessionId, revision) => {
    const loaded = get().loadedFor;
    if (loaded?.sessionId === sessionId && loaded.revision === revision) return;
    set({ loadedFor: { sessionId, revision } });

    try {
      const boxes = await invoke('pages:boxes', { sessionId });
      // A later revision may have overtaken this request.
      if (revisionOf(sessionId) !== revision) return;
      set({ boxes });
    } catch (error) {
      report(error);
      set({ boxes: [] });
    }
  },

  apply: async (sessionId, pageCount) => {
    const { frame, boxes, scope, rangeText, resizePage } = get();
    const margins = frameMargins(frame, boxes);
    if (frame === null || frame.sessionId !== sessionId || margins === null) return false;

    const chosen = pagesInScope(scope, rangeText, frame.page, pageCount);
    if ('problem' in chosen) {
      useUiStore.getState().showToast({ title: chosen.problem, intent: 'warning' });
      return false;
    }

    // A margin that would leave nothing of a smaller page is not applied to it.
    const fitting = chosen.pages.filter((page) => {
      const entry = boxes.find((candidate) => candidate.pageNumber === page);
      return entry !== undefined && marginsFit(visibleBox(entry), margins);
    });
    if (fitting.length === 0) {
      useUiStore.getState().showToast({
        title: 'That frame would leave nothing of the chosen pages.',
        intent: 'warning',
      });
      return false;
    }

    // The frame is drawn on what the page shows, so its margins are measured
    // from there whether the crop box or the page itself is being changed.
    const operations = cropOperations(
      boxes,
      fitting,
      margins,
      resizePage ? 'media' : 'crop',
      'crop',
    );
    if (operations.length === 0) return false;

    // The document store reports a failed edit itself; the revision says
    // whether this one landed.
    const before = revisionOf(sessionId);
    await useDocumentStore.getState().applyEdit(sessionId, {
      label: resizePage
        ? `Resize ${describeCount(fitting.length)}`
        : `Crop ${describeCount(fitting.length)}`,
      operations,
    });
    if (revisionOf(sessionId) === before) return false;

    set({ frame: null });
    const skipped = chosen.pages.length - fitting.length;
    if (skipped > 0) {
      useUiStore.getState().showToast({
        title: `${describeCount(skipped)} left as ${skipped === 1 ? 'it was' : 'they were'}.`,
        description: 'The frame would have left nothing of a smaller page.',
        intent: 'info',
      });
    }
    return true;
  },

  reset: async (sessionId, pageCount) => {
    const { frame, boxes, scope, rangeText } = get();
    const chosen = pagesInScope(scope, rangeText, frame?.page ?? null, pageCount);
    if ('problem' in chosen) {
      useUiStore.getState().showToast({ title: chosen.problem, intent: 'warning' });
      return false;
    }

    // Only pages that are cropped now have anything to reset.
    const cropped = chosen.pages.filter((page) => {
      const entry = boxes.find((candidate) => candidate.pageNumber === page);
      if (entry === undefined) return false;
      const shown = visibleBox(entry);
      const media = entry.media;
      return (
        shown.x !== media.x ||
        shown.y !== media.y ||
        shown.width !== media.width ||
        shown.height !== media.height
      );
    });
    if (cropped.length === 0) {
      useUiStore.getState().showToast({
        title: 'None of those pages is cropped.',
        intent: 'info',
      });
      return false;
    }

    const before = revisionOf(sessionId);
    await useDocumentStore.getState().applyEdit(sessionId, {
      label: `Reset the crop of ${describeCount(cropped.length)}`,
      operations: cropOperations(boxes, cropped, ZERO_MARGINS, 'crop', 'media'),
    });
    if (revisionOf(sessionId) === before) return false;
    set({ frame: null });
    return true;
  },
}));
