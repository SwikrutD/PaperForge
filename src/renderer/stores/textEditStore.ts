import { create } from 'zustand';
import { AppError } from '@shared/errors/appError';
import {
  DEFAULT_TEXT_STYLE,
  type PageTextModel,
  type TextRunModel,
  type TextStyle,
} from '@shared/schemas/text';
import { isDrawable, toWinAnsi } from '@pdf/text/layout';
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
  busy: boolean;

  setActive: (active: boolean) => void;
  /** Reads a page's text, unless this revision has already been read. */
  load: (sessionId: string, page: number, revision: number) => Promise<void>;
  select: (page: number, id: string | null) => void;
  /** Opens a run for typing, whether it will be rewritten or replaced. */
  beginEdit: (page: number, id: string) => void;
  setDraft: (text: string) => void;
  cancelEdit: () => void;
  /** Writes what was typed, as one undoable change. */
  commitEdit: () => Promise<void>;

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
  busy: false,

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

  select: (page, id) =>
    set({
      selected: id === null ? null : { page, id },
      draft: null,
      placement: null,
    }),

  beginEdit: (page, id) => {
    const sessionId = useDocumentStore.getState().activeId;
    if (sessionId === null) return;

    const run = runOf(get(), sessionId, page, id);
    if (run === undefined) return;

    set({ selected: { page, id }, draft: run.text, placement: null, placing: false });
  },

  setDraft: (draft) => set({ draft }),
  cancelEdit: () => set({ draft: null, placement: null }),

  commitEdit: async () => {
    const { selected, draft, placement, style } = get();
    const sessionId = useDocumentStore.getState().activeId;
    if (draft === null || sessionId === null) return;

    // New text, put where the reader pointed.
    if (placement !== null) {
      set({ draft: null, placement: null });
      if (draft.trim() === '') return;

      await run(() =>
        useDocumentStore.getState().applyEdit(sessionId, {
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
        }),
      );
      return;
    }

    if (selected === null) return;
    const existing = runOf(get(), sessionId, selected.page, selected.id);
    // Typing nothing new is not a change.
    if (existing === undefined || existing.text === draft) {
      set({ draft: null });
      return;
    }

    const replaceWith = async (): Promise<void> => {
      // PaperForge draws replacement text with the fonts every reader has, and
      // those are Latin-1. Anything else would come out as question marks, so
      // it is refused instead.
      if (!isDrawable(draft)) {
        set({ draft: null });
        useUiStore.getState().showToast({
          title: `PaperForge cannot write “${firstUndrawable(draft)}” into a PDF yet.`,
          description:
            'Replacement text is drawn with the standard fonts, which cover Latin-1 only. Embedding a font for other writing systems is not built yet.',
          intent: 'error',
        });
        return;
      }

      await run(() =>
        useDocumentStore.getState().applyEdit(sessionId, {
          label: draft === '' ? 'Delete text' : 'Replace text',
          operations: [
            {
              kind: 'replaceText',
              page: selected.page,
              runId: selected.id,
              text: draft,
              // Text PaperForge drew keeps whatever the reader has chosen;
              // text from the document keeps its own look.
              style: existing.replaced ? style : null,
            },
          ],
        }),
      );
      set({ draft: null, selected: null });
    };

    // A run PaperForge cannot rewrite in place is replaced outright.
    if (!existing.editable) {
      await replaceWith();
      return;
    }

    let verdict: { ok: boolean; missing: string | null };
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
    }

    if (verdict.ok) {
      await run(() =>
        useDocumentStore.getState().applyEdit(sessionId, {
          label: draft === '' ? 'Delete text' : 'Edit text',
          operations: [{ kind: 'editText', page: selected.page, runId: selected.id, text: draft }],
        }),
      );
      // The page has been rewritten, so what was selected no longer exists.
      set({ draft: null, selected: null });
      return;
    }

    // The font cannot write it. Replacing it is a different thing, so the
    // reader is asked rather than told afterwards.
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

  setStyle: (patch) => set((state) => ({ style: { ...state.style, ...patch } })),
  setPlacing: (placing) => set({ placing, selected: null, draft: null, placement: null }),
  placeText: (placement) => set({ placement, draft: '', placing: false, selected: null }),
}));

/** The first character the standard fonts cannot draw. */
function firstUndrawable(text: string): string {
  for (const character of text) {
    if (toWinAnsi(character) !== character) return character;
  }
  return '?';
}

/** Runs a change, keeping the editor from being used while it is in flight. */
async function run(work: () => Promise<void>): Promise<void> {
  useTextEditStore.setState({ busy: true });
  try {
    await work();
  } finally {
    useTextEditStore.setState({ busy: false });
  }
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
