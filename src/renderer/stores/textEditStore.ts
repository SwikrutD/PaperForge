import { create } from 'zustand';
import { AppError } from '@shared/errors/appError';
import type { EditTransaction } from '@shared/schemas/edit';
import {
  DEFAULT_TEXT_STYLE,
  type PageTextModel,
  type TextColor,
  type TextFamily,
  type TextRunModel,
  type TextStyle,
} from '@shared/schemas/text';
import { encodeWinAnsi } from '@pdf/text/layout';
import { invoke } from '../services/ipcClient';
import { useDocumentStore } from './documentStore';
import { useUiStore } from './uiStore';

/** The text of one page, once it has been read. */
export interface LoadedPage {
  model: PageTextModel;
  /** The revision it was read from; a later one makes it stale. */
  revision: number;
}

/** Where new text is about to go, once the reader has pointed at a page. */
export interface TextPlacement {
  page: number;
  /** Where the baseline starts, in PDF user space. */
  x: number;
  y: number;
}

/**
 * Text that has just been written, drawn over the page until the page's own
 * picture shows it. Without it the old words would come back for the moment
 * between Enter and the redrawn page.
 */
export interface PendingText {
  sessionId: string;
  page: number;
  /** Where the words start, in PDF user space; `y` is the baseline. */
  x: number;
  y: number;
  /** The text being replaced, which is covered over; null for new text. */
  covers: { x: number; y: number; width: number; height: number } | null;
  text: string;
  fontSize: number;
  family: TextFamily;
  color: TextColor;
  /** The revision the change produced; null while it is still being written. */
  madeIn: number | null;
}

export interface TextEditStore {
  /** True while the text editor is on. */
  active: boolean;
  /** Keyed by `${sessionId}:${page}`. */
  pages: Map<string, LoadedPage>;
  /** The run the reader is working on, if any. */
  selected: { page: number; id: string } | null;
  /** The text being typed, while a run or a new box is open. */
  draft: string | null;
  /** True while the reader is choosing where new text goes. */
  placing: boolean;
  /** Where the new text will be drawn, once they have chosen. */
  placement: TextPlacement | null;
  /** What text PaperForge draws itself looks like. */
  style: TextStyle;
  /**
   * True once the reader has changed the style since opening the run being
   * edited. A changed style is applied on the edit — as a replacement drawn in
   * that style — even when the words are left as they were.
   */
  styleTouched: boolean;
  busy: boolean;
  /** The text last written, until its page has been redrawn. */
  pendingText: PendingText | null;

  setActive: (active: boolean) => void;
  /** Reads a page's text, unless this revision has already been read. */
  load: (sessionId: string, page: number, revision: number) => Promise<void>;
  /** Selects a run, keeping whatever was being typed into the last one. */
  select: (page: number, id: string | null) => void;
  /** Opens a run for typing, whether it will be rewritten or replaced. */
  beginEdit: (page: number, id: string) => void;
  setDraft: (text: string) => void;
  cancelEdit: () => void;
  /** Writes what was typed, as one undoable change. */
  commitEdit: () => Promise<void>;
  /** Forgets the pending text once its page shows it. */
  settlePending: () => void;
  /** Forgets pending text that undo has taken back out of the document. */
  dropUndonePending: (sessionId: string, revision: number) => void;

  setStyle: (patch: Partial<TextStyle>) => void;
  setPlacing: (placing: boolean) => void;
  /** Starts a new box of text at a point on a page. */
  placeText: (placement: TextPlacement) => void;
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
 * The text editor's own state: which page's text has been read, what is
 * selected, what is being typed, and what PaperForge's own text looks like.
 *
 * The model belongs to a revision. Every change makes a new one, so a page is
 * read again after each edit rather than being patched in place — the ids of
 * the runs come from the content, and the content has just been rewritten.
 */
export const useTextEditStore = create<TextEditStore>((set, get) => ({
  active: false,
  pages: new Map(),
  selected: null,
  draft: null,
  placing: false,
  placement: null,
  style: DEFAULT_TEXT_STYLE,
  styleTouched: false,
  busy: false,
  pendingText: null,

  setActive: (active) =>
    set({ active, selected: null, draft: null, placing: false, placement: null }),

  load: async (sessionId, page, revision) => {
    const key = keyOf(sessionId, page);
    const existing = get().pages.get(key);
    if (existing !== undefined && existing.revision === revision) return;

    try {
      const model = await invoke('text:page', { sessionId, page });
      set((state) => {
        const pages = new Map(state.pages);
        pages.set(key, { model, revision: model.revision });
        return { pages };
      });
    } catch (error) {
      report(error);
    }
  },

  select: (page, id) => {
    // Pointing somewhere else is how a reader moves on from what they typed,
    // so it is written rather than thrown away. The commit reads everything it
    // needs before the selection below changes.
    if (get().draft !== null) void get().commitEdit();
    set({
      selected: id === null ? null : { page, id },
      draft: null,
      placement: null,
    });
  },

  beginEdit: (page, id) => {
    const sessionId = useDocumentStore.getState().activeId;
    if (sessionId === null) return;

    const run = runOf(get(), sessionId, page, id);
    if (run === undefined) return;

    // Opening the run that is already open changes nothing: what was typed
    // and the style chosen for it stay as they are.
    const { selected, draft, placement } = get();
    if (selected?.page === page && selected.id === id && draft !== null && placement === null) {
      return;
    }

    // The style controls start from how the run looks, so what the reader
    // changes there is a change to this text rather than to a default.
    set({
      selected: { page, id },
      draft: run.text,
      placement: null,
      placing: false,
      style: lookOf(run),
      styleTouched: false,
    });
  },

  setDraft: (draft) => set({ draft }),
  cancelEdit: () => set({ draft: null, placement: null }),

  commitEdit: async () => {
    const { selected, draft, placement, style, styleTouched, busy } = get();
    const sessionId = useDocumentStore.getState().activeId;
    // One change at a time: Enter followed by the field losing focus, or a
    // click elsewhere while a change is still being written, must not send it
    // twice — the second would point at runs the first has just rewritten.
    if (draft === null || sessionId === null || busy) return;

    // New text, put where the reader pointed.
    if (placement !== null) {
      if (draft.trim() === '') {
        set({ draft: null, placement: null });
        return;
      }
      // Kept open, so the reader can correct what cannot be drawn.
      if (refuseUndrawable(draft)) return;
      set({ draft: null, placement: null });

      await write(
        sessionId,
        {
          page: placement.page,
          x: placement.x,
          y: placement.y,
          covers: null,
          text: draft,
          fontSize: style.size,
          family: style.family,
          color: style.color,
        },
        {
          label: 'Add text',
          operations: [
            {
              kind: 'addText',
              page: placement.page,
              x: placement.x,
              y: placement.y,
              text: draft,
              style,
            },
          ],
        },
      );
      return;
    }

    if (selected === null) return;
    const existing = runOf(get(), sessionId, selected.page, selected.id);
    // Typing nothing new, and choosing no new style, is not a change.
    if (existing === undefined || (existing.text === draft && !styleTouched)) {
      set({ draft: null });
      return;
    }

    /**
     * What the page is about to say, drawn over the old words until it does.
     * Invisible text — a recognised scan's text layer — has nothing to show.
     */
    const preview = (restyled: boolean): Omit<PendingText, 'sessionId' | 'madeIn'> | null =>
      existing.invisible
        ? null
        : {
            page: selected.page,
            x: existing.baselineX,
            y: existing.baselineY,
            covers: {
              x: existing.x,
              y: existing.y,
              width: existing.width,
              height: existing.height,
            },
            text: draft,
            fontSize: restyled ? style.size : existing.fontSize,
            family: restyled ? style.family : familyOf(existing.baseFont),
            color: restyled ? style.color : existing.color,
          };

    const replaceWith = async (): Promise<void> => {
      // PaperForge draws replacement text with the fonts every reader has.
      // Anything they cannot draw would come out as question marks, so it is
      // refused instead, and the draft stays open to be corrected.
      if (refuseUndrawable(draft)) return;

      set({ draft: null, selected: null, styleTouched: false });
      await write(sessionId, preview(styleTouched), {
        label: draft === '' ? 'Delete text' : 'Replace text',
        operations: [
          {
            kind: 'replaceText',
            page: selected.page,
            runId: selected.id,
            text: draft,
            // A style the reader chose for this text is applied; otherwise
            // the text keeps its own look, whoever drew it.
            style: styleTouched ? style : null,
          },
        ],
      });
    };

    // A run PaperForge cannot rewrite in place is replaced outright, and so
    // is one the reader has restyled: its own font cannot take a new style.
    if (!existing.editable || styleTouched) {
      await replaceWith();
      return;
    }

    let verdict: { ok: boolean; missing: string | null };
    set({ busy: true });
    try {
      verdict = await invoke('text:canWrite', {
        sessionId,
        page: selected.page,
        runId: selected.id,
        text: draft,
      });
    } catch (error) {
      report(error);
      return;
    } finally {
      set({ busy: false });
    }

    if (verdict.ok) {
      // The page is about to be rewritten, so what was selected will no longer
      // exist; the words typed stand in for it until the page is redrawn.
      set({ draft: null, selected: null });
      await write(sessionId, preview(false), {
        label: draft === '' ? 'Delete text' : 'Edit text',
        operations: [{ kind: 'editText', page: selected.page, runId: selected.id, text: draft }],
      });
      return;
    }

    // The font cannot write it. Replacing it is a different thing, so the
    // reader is asked rather than told afterwards — unless the standard fonts
    // cannot write it either, which is said before anything is offered.
    if (refuseUndrawable(draft)) return;
    useUiStore.getState().requestConfirmation({
      title: 'Replace this text instead?',
      message:
        verdict.missing === null
          ? 'This text cannot be rewritten in the font that drew it. PaperForge can take it out and draw your text in a standard font instead, which may look slightly different.'
          : `The font this text is drawn in cannot write “${verdict.missing}”. PaperForge can take the old text out and draw yours in a standard font instead, which may look slightly different.`,
      confirmLabel: 'Replace the text',
      onConfirm: () => void replaceWith(),
    });
  },

  settlePending: () => set({ pendingText: null }),

  dropUndonePending: (sessionId, revision) => {
    const pending = get().pendingText;
    if (pending?.sessionId === sessionId && pending.madeIn !== null && pending.madeIn > revision) {
      set({ pendingText: null });
    }
  },

  setStyle: (patch) =>
    set((state) => ({ style: { ...state.style, ...patch }, styleTouched: true })),
  setPlacing: (placing) => set({ placing, selected: null, draft: null, placement: null }),
  placeText: (placement) => set({ placement, draft: '', placing: false, selected: null }),
}));

/**
 * Refuses text the standard fonts cannot draw, naming the characters that
 * stopped it. Returns true when it refused.
 *
 * The standard fonts are WinAnsi: Western European letters and the usual
 * punctuation (curly quotes, dashes, ellipsis, euro, bullets). Writing
 * anything else would silently become question marks.
 */
function refuseUndrawable(text: string): boolean {
  const { undrawable } = encodeWinAnsi(text);
  if (undrawable.length === 0) return false;

  const shown = undrawable.slice(0, 5).map((character) => `“${character}”`);
  const more = undrawable.length > shown.length ? ' and others' : '';
  useUiStore.getState().showToast({
    title: `PaperForge cannot write ${shown.join(', ')}${more} with a standard font.`,
    description:
      'Text PaperForge draws itself uses the standard PDF fonts, which cover Western European letters and common punctuation. Change those characters, or press Escape to leave the text as it was. Embedding a font for other writing systems is not built yet.',
    intent: 'warning',
  });
  return true;
}

/** The revision a document is at, as its tab knows it. */
function revisionOf(sessionId: string): number | undefined {
  return useDocumentStore.getState().tabs.find((tab) => tab.session.id === sessionId)?.edit
    .revision;
}

/**
 * Writes a change, keeping the editor from being used while it is in flight,
 * and shows what was written over the page until the page is redrawn with it.
 */
async function write(
  sessionId: string,
  preview: Omit<PendingText, 'sessionId' | 'madeIn'> | null,
  transaction: EditTransaction,
): Promise<void> {
  const before = revisionOf(sessionId);
  useTextEditStore.setState({
    busy: true,
    pendingText: preview === null ? null : { ...preview, sessionId, madeIn: null },
  });
  try {
    await useDocumentStore.getState().applyEdit(sessionId, transaction);
  } finally {
    const after = revisionOf(sessionId);
    useTextEditStore.setState((state) => ({
      busy: false,
      pendingText:
        state.pendingText === null || state.pendingText.madeIn !== null
          ? state.pendingText
          : // Nothing was written, so there is nothing to wait for.
            after === undefined || after === before
            ? null
            : { ...state.pendingText, madeIn: after },
    }));
  }
}

/** The standard family closest to a font the document names. */
function familyOf(baseFont: string): TextFamily {
  const name = baseFont.toLowerCase();
  if (name.includes('courier') || name.includes('mono')) return 'courier';
  if (name.includes('sans')) return 'helvetica';
  if (name.includes('times') || name.includes('serif') || name.includes('roman')) return 'times';
  return 'helvetica';
}

/** How a run looks, as the nearest style PaperForge can draw it in. */
function lookOf(run: TextRunModel): TextStyle {
  const name = run.baseFont.toLowerCase();
  return {
    family: familyOf(run.baseFont),
    bold: /bold|black|heavy/.test(name),
    italic: /italic|oblique/.test(name),
    // The schema's bounds; a run seen at 0.5 pt is still edited sensibly.
    size: Math.min(400, Math.max(1, Math.round(run.fontSize * 100) / 100)),
    color: run.color,
  };
}

function runOf(
  store: TextEditStore,
  sessionId: string,
  page: number,
  id: string,
): TextRunModel | undefined {
  return store.pages
    .get(keyOf(sessionId, page))
    ?.model.runs.find((candidate) => candidate.id === id);
}

/** The runs of a page, or none while it is still being read. */
export function runsFor(
  pages: ReadonlyMap<string, LoadedPage>,
  sessionId: string,
  page: number,
): readonly TextRunModel[] {
  return pages.get(keyOf(sessionId, page))?.model.runs ?? NO_RUNS;
}

/** One frozen empty list, so a page with no text does not re-render forever. */
const NO_RUNS: readonly TextRunModel[] = Object.freeze([]);
