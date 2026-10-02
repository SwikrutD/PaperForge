import { create } from 'zustand';
import { AppError } from '@shared/errors/appError';
import type { LoadedPdfDocument } from '@pdf/render/types';
import { diffWords, wordsOf } from '@pdf/compare/textDiff';
import {
  pageDifference,
  pairPages,
  sizeDifference,
  textDifferences,
  visualDifferences,
  type Difference,
  type PagePair,
  type Rect,
} from '@pdf/compare/model';
import type { PixelRegion } from '@pdf/compare/pixelDiff';
import { cssRectToPdf } from '../components/viewer/pageGeometry';
import { compareDocument, releaseCompareDocuments } from '../services/compareDocuments';
import { diffInWorker, drawPair } from '../services/compareRender';
import { useDocumentStore } from './documentStore';
import { useJobStore } from './jobStore';
import { useUiStore } from './uiStore';

/**
 * Compare Files: which two documents, how their pages pair up, and what was
 * found. Everything happens in this window and its worker; nothing is
 * written anywhere.
 */

export type CompareSide = 'original' | 'revised';
export type CompareMode = 'sideBySide' | 'overlay';

export interface CompareOverlay {
  pair: number;
  width: number;
  height: number;
  /** CSS pixels per PDF unit the picture was drawn at. */
  scale: number;
  pixels: Uint8ClampedArray;
}

interface ComparedFor {
  original: string;
  originalRevision: number;
  revised: string;
  revisedRevision: number;
  offset: number;
}

interface CompareState {
  open: boolean;
  originalId: string | null;
  revisedId: string | null;
  /** How many pages the revision runs ahead of the original. */
  offset: number;
  mode: CompareMode;
  syncScroll: boolean;
  filters: { text: boolean; visual: boolean };
  status: 'idle' | 'running' | 'done' | 'cancelled' | 'failed';
  progress: { done: number; total: number } | null;
  pairs: PagePair[];
  differences: Difference[];
  comparedFor: ComparedFor | null;
  currentPair: number;
  selectedId: string | null;
  /** Bumped to ask the panes to bring the selected difference into view. */
  focusNonce: number;
  overlay: CompareOverlay | null;

  setOpen: (open: boolean) => void;
  choose: (side: CompareSide, sessionId: string | null) => void;
  setOffset: (offset: number) => void;
  setMode: (mode: CompareMode) => void;
  setSyncScroll: (sync: boolean) => void;
  setFilter: (filter: 'text' | 'visual', on: boolean) => void;
  run: () => Promise<void>;
  cancel: () => void;
  goToPair: (index: number) => void;
  select: (id: string) => void;
  /** Moves to the next or previous difference the filters show. */
  step: (direction: 1 | -1) => void;
  loadOverlay: (pair: number) => Promise<void>;
}

let cancelled = false;
let activeJob: string | null = null;

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

/** The differences the filters let through, in page order. */
export function visibleDifferences(
  differences: readonly Difference[],
  filters: { text: boolean; visual: boolean },
): Difference[] {
  return differences.filter((difference) =>
    difference.kind.startsWith('text') ? filters.text : filters.visual,
  );
}

/** A region of pixels as a rectangle on one page, or null when it is off that page. */
function regionOnPage(
  region: PixelRegion,
  document: LoadedPdfDocument,
  pageNumber: number,
  scale: number,
): Rect | null {
  const size = document.pageSize(pageNumber, scale, 0);
  const left = Math.max(0, region.left);
  const top = Math.max(0, region.top);
  const width = Math.min(size.width, region.left + region.width) - left;
  const height = Math.min(size.height, region.top + region.height) - top;
  const geometry = document.pages[pageNumber - 1];
  if (width <= 0 || height <= 0 || geometry === undefined) return null;
  return cssRectToPdf({ left, top, width, height }, geometry, scale, 0);
}

async function comparePair(
  pair: PagePair,
  original: LoadedPdfDocument,
  revised: LoadedPdfDocument,
): Promise<Difference[]> {
  const unmatched = pageDifference(pair);
  if (unmatched !== null || pair.original === null || pair.revised === null) {
    return unmatched === null ? [] : [unmatched];
  }

  const [originalText, revisedText] = await Promise.all([
    original.getPageText(pair.original),
    revised.getPageText(pair.revised),
  ]);
  const text = textDifferences(pair.index, diffWords(wordsOf(originalText), wordsOf(revisedText)));

  const size = sizeDifference(
    pair.index,
    original.pageSize(pair.original, 1, 0),
    revised.pageSize(pair.revised, 1, 0),
  );

  const pixels = await drawPair(original, pair.original, revised, pair.revised);
  const { regions } = await diffInWorker(pixels, false);
  const visual = visualDifferences(
    pair.index,
    regions.map((region) => ({
      original: regionOnPage(region, original, pair.original as number, pixels.scale),
      revised: regionOnPage(region, revised, pair.revised as number, pixels.scale),
    })),
    {
      original: text.flatMap((difference) => difference.originalRects),
      revised: text.flatMap((difference) => difference.revisedRects),
    },
  );

  return [...(size === null ? [] : [size]), ...text, ...visual];
}

export const useCompareStore = create<CompareState>((set, get) => ({
  open: false,
  originalId: null,
  revisedId: null,
  offset: 0,
  mode: 'sideBySide',
  syncScroll: true,
  filters: { text: true, visual: true },
  status: 'idle',
  progress: null,
  pairs: [],
  differences: [],
  comparedFor: null,
  currentPair: 1,
  selectedId: null,
  focusNonce: 0,
  overlay: null,

  setOpen: (open) => {
    if (!open) {
      get().cancel();
      void releaseCompareDocuments();
      set({
        open,
        status: 'idle',
        pairs: [],
        differences: [],
        comparedFor: null,
        overlay: null,
        selectedId: null,
      });
      return;
    }
    // Start from the two documents most likely meant: the one in front and
    // the one beside it.
    const { tabs, activeId } = useDocumentStore.getState();
    const others = tabs.filter((tab) => tab.session.id !== activeId);
    set({
      open,
      originalId: get().originalId ?? activeId ?? tabs[0]?.session.id ?? null,
      revisedId: get().revisedId ?? others[0]?.session.id ?? null,
    });
  },

  choose: (side, sessionId) =>
    set(side === 'original' ? { originalId: sessionId } : { revisedId: sessionId }),
  setOffset: (offset) => set({ offset: Math.max(-999, Math.min(999, Math.round(offset))) }),
  setMode: (mode) => set({ mode }),
  setSyncScroll: (syncScroll) => set({ syncScroll }),
  setFilter: (filter, on) => set((state) => ({ filters: { ...state.filters, [filter]: on } })),

  run: async () => {
    const { originalId, revisedId, offset } = get();
    if (originalId === null || revisedId === null || get().status === 'running') return;

    cancelled = false;
    const jobs = useJobStore.getState();
    const job = jobs.start({ type: 'compare', title: 'Comparing documents' }, () => {
      cancelled = true;
    });
    activeJob = job;
    const comparedFor: ComparedFor = {
      original: originalId,
      originalRevision: revisionOf(originalId),
      revised: revisedId,
      revisedRevision: revisionOf(revisedId),
      offset,
    };
    set({
      status: 'running',
      differences: [],
      pairs: [],
      overlay: null,
      selectedId: null,
      currentPair: 1,
      comparedFor,
      progress: null,
    });

    try {
      const [original, revised] = await Promise.all([
        compareDocument('original', originalId, comparedFor.originalRevision),
        compareDocument('revised', revisedId, comparedFor.revisedRevision),
      ]);
      const pairs = pairPages(original.info.pageCount, revised.info.pageCount, offset);
      set({ pairs, progress: { done: 0, total: pairs.length } });
      useJobStore.getState().progress(job, { totalItems: pairs.length });

      for (const pair of pairs) {
        if (cancelled) break;
        const found = await comparePair(pair, original, revised);
        set((state) => ({
          differences: [...state.differences, ...found],
          progress: { done: pair.index, total: pairs.length },
        }));
        useJobStore.getState().progress(job, {
          completedItems: pair.index,
          currentItem: `Page pair ${String(pair.index)} of ${String(pairs.length)}`,
        });
      }

      if (cancelled) {
        set({ status: 'cancelled' });
        return;
      }
      useJobStore.getState().succeed(job);
      set({ status: 'done' });
      const first = visibleDifferences(get().differences, get().filters)[0];
      if (first !== undefined) get().select(first.id);
    } catch (error) {
      useJobStore.getState().fail(job, AppError.serialize(error).message);
      set({ status: 'failed' });
      report(error);
    } finally {
      activeJob = null;
    }
  },

  cancel: () => {
    if (activeJob !== null) useJobStore.getState().cancel(activeJob);
    cancelled = true;
  },

  goToPair: (index) => {
    const count = get().pairs.length;
    if (count === 0) return;
    set({ currentPair: Math.max(1, Math.min(count, index)) });
  },

  select: (id) => {
    const difference = get().differences.find((candidate) => candidate.id === id);
    if (difference === undefined) return;
    set((state) => ({
      selectedId: id,
      currentPair: difference.pair,
      focusNonce: state.focusNonce + 1,
    }));
  },

  step: (direction) => {
    const shown = visibleDifferences(get().differences, get().filters);
    if (shown.length === 0) return;
    const index = shown.findIndex((difference) => difference.id === get().selectedId);
    const next =
      index < 0
        ? direction === 1
          ? 0
          : shown.length - 1
        : (index + direction + shown.length) % shown.length;
    const target = shown[next];
    if (target !== undefined) get().select(target.id);
  },

  loadOverlay: async (pairIndex) => {
    const { comparedFor, pairs, overlay } = get();
    if (comparedFor === null || overlay?.pair === pairIndex) return;
    const pair = pairs.find((candidate) => candidate.index === pairIndex);
    if (pair === undefined || pair.original === null || pair.revised === null) {
      set({ overlay: null });
      return;
    }
    try {
      const [original, revised] = await Promise.all([
        compareDocument('original', comparedFor.original, comparedFor.originalRevision),
        compareDocument('revised', comparedFor.revised, comparedFor.revisedRevision),
      ]);
      const pixels = await drawPair(original, pair.original, revised, pair.revised);
      const { width, height, scale } = pixels;
      const result = await diffInWorker(pixels, true);
      if (result.overlay === null || get().currentPair !== pairIndex) return;
      set({ overlay: { pair: pairIndex, width, height, scale, pixels: result.overlay } });
    } catch (error) {
      report(error);
    }
  },
}));
