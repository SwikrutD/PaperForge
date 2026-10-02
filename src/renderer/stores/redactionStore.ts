import { create } from 'zustand';
import type { LoadedPdfDocument } from '@pdf/render/types';
import { AppError } from '@shared/errors/appError';
import type { EditOperation } from '@shared/schemas/edit';
import {
  DEFAULT_REDACTION_APPEARANCE,
  type RasterPage,
  type RedactionAppearance,
  type RedactionMark,
  type RedactionPlan,
  type RedactionRect,
  type RedactionSource,
} from '@shared/schemas/redaction';
import type { SanitizeCategory } from '@shared/schemas/sanitize';
import { invoke } from '../services/ipcClient';
import { renderPageForRedaction } from '../services/redactionRender';
import { createId } from '../utils/ids';
import { useDocumentStore } from './documentStore';
import { useUiStore } from './uiStore';

/**
 * Redaction marks, before they are applied.
 *
 * A mark is pending until the reader applies it: it lives here, belongs to
 * one open document, and changes nothing in the file. Applying is a single
 * undoable edit; saving is what makes it permanent.
 */

export type RedactionTool = 'text' | 'area';

export interface PendingMark extends RedactionMark {
  source: RedactionSource;
  /** What the list calls it: the words found or selected, or "Area". */
  label: string;
  /** The revision it was drawn on; another one may have moved what it covers. */
  revision: number;
}

/**
 * The hidden information removed alongside redactions when the reader asks.
 * Form values are left out: a form emptied of everything is a different
 * request, and the fields under a mark are already gone.
 */
export const REDACTION_SANITIZE: readonly SanitizeCategory[] = [
  'metadata',
  'xmpMetadata',
  'attachments',
  'documentJavaScript',
  'launchActions',
  'hiddenAnnotations',
  'thumbnails',
  'hiddenLayers',
  'alternateImages',
];

export interface ApplyOptions {
  /** Draws every marked page as a picture, whatever could be cut natively. */
  rasterizeAll: boolean;
  /** Removes hidden information in the same step. */
  sanitize: boolean;
  /** Asks where to save the redacted document straight afterwards. */
  saveAs: boolean;
}

interface RedactionState {
  active: boolean;
  tool: RedactionTool;
  /** The reason given to marks made from now on. */
  reason: string;
  marks: Record<string, PendingMark[]>;
  selectedId: string | null;
  appearance: RedactionAppearance;
  searching: boolean;
  applying: boolean;

  setActive: (active: boolean) => void;
  setTool: (tool: RedactionTool) => void;
  setReason: (reason: string) => void;
  setAppearance: (appearance: RedactionAppearance) => void;
  addMark: (
    sessionId: string,
    mark: { page: number; rects: RedactionRect[]; source: RedactionSource; label: string },
  ) => void;
  removeMark: (sessionId: string, id: string) => void;
  clearMarks: (sessionId: string) => void;
  select: (id: string | null) => void;
  /** Finds text and marks every occurrence; returns how many were marked. */
  findAndMark: (
    sessionId: string,
    query: string,
    options: { matchCase: boolean; wholeWord: boolean },
  ) => Promise<number>;
  plan: (sessionId: string) => Promise<RedactionPlan | null>;
  /** Applies every pending mark of a document. True when it was applied. */
  apply: (
    sessionId: string,
    document: LoadedPdfDocument,
    plan: RedactionPlan,
    options: ApplyOptions,
  ) => Promise<boolean>;
}

export function marksFor(
  marks: Readonly<Record<string, PendingMark[]>>,
  sessionId: string | null,
): PendingMark[] {
  return sessionId === null ? NO_MARKS : (marks[sessionId] ?? NO_MARKS);
}

const NO_MARKS: PendingMark[] = [];

function revisionOf(sessionId: string): number {
  return (
    useDocumentStore.getState().tabs.find((tab) => tab.session.id === sessionId)?.edit.revision ?? 0
  );
}

function report(error: unknown): void {
  const serialized = AppError.serialize(error);
  useUiStore.getState().showToast({
    title: serialized.message,
    description: serialized.details,
    intent: 'error',
  });
}

function toMark({ id, page, rects, reason }: PendingMark): RedactionMark {
  return { id, page, rects, reason };
}

export const useRedactionStore = create<RedactionState>((set, get) => ({
  active: false,
  tool: 'area',
  reason: '',
  marks: {},
  selectedId: null,
  appearance: DEFAULT_REDACTION_APPEARANCE,
  searching: false,
  applying: false,

  setActive: (active) => set({ active, selectedId: null }),
  setTool: (tool) => set({ tool }),
  setReason: (reason) => set({ reason: reason.slice(0, 120) }),
  setAppearance: (appearance) => set({ appearance }),

  addMark: (sessionId, mark) => {
    const reason = get().reason.trim();
    const pending: PendingMark = {
      id: createId('redaction'),
      page: mark.page,
      rects: mark.rects,
      reason: reason === '' ? null : reason,
      source: mark.source,
      label: mark.label,
      revision: revisionOf(sessionId),
    };
    set((state) => ({
      marks: { ...state.marks, [sessionId]: [...marksFor(state.marks, sessionId), pending] },
      selectedId: pending.id,
    }));
  },

  removeMark: (sessionId, id) =>
    set((state) => ({
      marks: {
        ...state.marks,
        [sessionId]: marksFor(state.marks, sessionId).filter((mark) => mark.id !== id),
      },
      selectedId: state.selectedId === id ? null : state.selectedId,
    })),

  clearMarks: (sessionId) =>
    set((state) => ({ marks: { ...state.marks, [sessionId]: [] }, selectedId: null })),

  select: (selectedId) => set({ selectedId }),

  findAndMark: async (sessionId, query, options) => {
    const trimmed = query.trim();
    if (trimmed === '') return 0;
    set({ searching: true });
    try {
      const result = await invoke('redaction:find', {
        sessionId,
        search: { query: trimmed, ...options },
      });
      for (const match of result.matches) {
        get().addMark(sessionId, {
          page: match.page,
          rects: match.rects,
          source: 'search',
          label: match.text,
        });
      }

      const ui = useUiStore.getState();
      const skipped = [...result.textlessPages, ...result.unreadablePages];
      ui.showToast({
        title:
          result.matches.length === 0
            ? `“${trimmed}” was not found.`
            : `Marked ${String(result.matches.length)} ${
                result.matches.length === 1 ? 'occurrence' : 'occurrences'
              } of “${trimmed}”.`,
        description:
          skipped.length === 0
            ? undefined
            : `${String(skipped.length)} ${
                skipped.length === 1 ? 'page has' : 'pages have'
              } no text PaperForge can search, such as a scan or text drawn inside a group. Recognize Text first, or mark areas on ${
                skipped.length === 1 ? 'it' : 'them'
              } by hand.`,
        intent: result.matches.length === 0 ? 'info' : 'success',
      });
      return result.matches.length;
    } catch (error) {
      report(error);
      return 0;
    } finally {
      set({ searching: false });
    }
  },

  plan: async (sessionId) => {
    const marks = marksFor(get().marks, sessionId);
    if (marks.length === 0) return null;
    try {
      return await invoke('redaction:plan', { sessionId, marks: marks.map(toMark) });
    } catch (error) {
      report(error);
      return null;
    }
  },

  apply: async (sessionId, document, plan, options) => {
    const marks = marksFor(get().marks, sessionId);
    if (marks.length === 0) return false;
    const documents = useDocumentStore.getState();
    const before = revisionOf(sessionId);
    if (plan.revision !== before) {
      useUiStore.getState().showToast({
        title: 'The document changed while the redactions were being reviewed.',
        description: 'Review them again before applying.',
        intent: 'warning',
      });
      return false;
    }

    set({ applying: true });
    try {
      // Pages that cannot be cut are drawn here, with the marks painted on,
      // and handed over as pictures.
      const pictured = plan.pages
        .filter((page) => options.rasterizeAll || page.mode === 'raster')
        .map((page) => page.page);
      const rasterPages: RasterPage[] = [];
      for (const page of pictured) {
        const rects = marks.filter((mark) => mark.page === page).flatMap((mark) => mark.rects);
        const rendered = await renderPageForRedaction(document, page, rects, get().appearance.fill);
        const { token } = await invoke('redaction:stagePage', {
          sessionId,
          page,
          image: rendered.image,
        });
        rasterPages.push({ page, token, viewBox: rendered.viewBox });
      }

      const operations: EditOperation[] = [];
      // Hidden information goes first, so the clean-up redaction does at the
      // end sweeps up whatever it leaves unreferenced.
      if (options.sanitize)
        operations.push({ kind: 'sanitize', categories: [...REDACTION_SANITIZE] });
      operations.push({
        kind: 'applyRedactions',
        marks: marks.map(({ page, rects, reason }) => ({ page, rects, reason })),
        appearance: get().appearance,
        rasterPages,
      });

      await documents.applyEdit(sessionId, {
        label:
          marks.length === 1 ? 'Apply a redaction' : `Apply ${String(marks.length)} redactions`,
        operations,
      });
      // An edit that failed has already said why; the marks stay to try again.
      if (revisionOf(sessionId) === before) return false;

      get().clearMarks(sessionId);
      const pages = new Set(marks.map((mark) => mark.page)).size;
      useUiStore.getState().showToast({
        title: `Redactions applied on ${String(pages)} ${pages === 1 ? 'page' : 'pages'}.`,
        description:
          'Each page was read back and nothing remains under the marks. Undo is available until you save.',
        intent: 'success',
      });

      if (options.saveAs) await documents.save(sessionId, 'saveAs', 'redacted');
      return true;
    } catch (error) {
      report(error);
      return false;
    } finally {
      set({ applying: false });
    }
  },
}));
