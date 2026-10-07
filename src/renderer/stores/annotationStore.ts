import { create } from 'zustand';
import { AppError } from '@shared/errors/appError';
import {
  DEFAULT_ANNOTATION_STYLE,
  type Annotation,
  type AnnotationInput,
  type AnnotationKind,
  type AnnotationPatch,
  type AnnotationStyle,
  type BuiltInStamp,
  type StampImage,
} from '@shared/schemas/annotation';
import { describeInput, describeKind } from '@pdf/mutate/operations';
import { invoke } from '../services/ipcClient';
import { useDocumentStore } from './documentStore';
import { useUiStore } from './uiStore';

/** What the pointer does on a page right now. */
export type AnnotationTool = 'select' | AnnotationKind | 'eraser';

export type CommentSort = 'page' | 'newest' | 'author';

export interface CommentFilter {
  /** Empty means every kind. */
  kinds: AnnotationKind[];
  /** Empty means every author. */
  authors: string[];
  status: 'all' | 'open' | 'resolved';
}

export const DEFAULT_FILTER: CommentFilter = { kinds: [], authors: [], status: 'all' };

/**
 * A mark the reader has just made, drawn over the page until the page's own
 * picture includes it. Without it a new highlight would vanish the moment the
 * pointer lifted and reappear once the document had been rewritten and drawn.
 */
export interface PendingAnnotation {
  id: string;
  sessionId: string;
  input: AnnotationInput;
  /** The revision the change produced; null while it is still being written. */
  madeIn: number | null;
}

let pendingCounter = 0;

/** How far a duplicate lands from what it copies: down and to the right. */
const DUPLICATE_OFFSET = 12;

interface AnnotationStore {
  tool: AnnotationTool;
  /** Style new annotations are created with, and what the properties panel edits. */
  style: AnnotationStyle;
  stampLabel: BuiltInStamp;
  /** Text a new text box starts with, such as today's date. */
  pendingText: string | null;
  /** Annotations of the active document, as the file records them. */
  annotations: Annotation[];
  /** Which document and revision the list came from. */
  loadedFor: { sessionId: string; revision: number } | null;
  loading: boolean;
  selectedId: string | null;
  /** The free text box being typed into, before it exists in the document. */
  draft: AnnotationInput | null;
  /** Marks being written, shown over their pages until those are redrawn. */
  pending: PendingAnnotation[];
  sort: CommentSort;
  filter: CommentFilter;

  setTool: (tool: AnnotationTool) => void;
  setStyle: (patch: Partial<AnnotationStyle>) => void;
  setStampLabel: (label: BuiltInStamp) => void;
  select: (id: string | null) => void;
  setSort: (sort: CommentSort) => void;
  setFilter: (filter: Partial<CommentFilter>) => void;
  setDraft: (draft: AnnotationInput | null) => void;
  /** Text a new box starts with, such as today's date. */
  setPendingText: (text: string | null) => void;

  /** Reads the annotations of a document revision, once. */
  load: (sessionId: string, revision: number) => Promise<void>;
  /** Adds annotations to the active document as one undoable step. */
  add: (inputs: readonly AnnotationInput[]) => Promise<void>;
  update: (id: string, patch: AnnotationPatch, label?: string) => Promise<void>;
  /** Resizes and turns a stamp PaperForge made, as one undoable step. */
  transform: (
    id: string,
    rect: { x: number; y: number; width: number; height: number },
    rotation: number,
  ) => Promise<void>;
  /** Copies a stamp a little way off, and selects the copy. */
  duplicate: (id: string) => Promise<void>;
  remove: (ids: readonly string[]) => Promise<void>;
  /** Forgets pending marks once their page shows them. */
  settlePending: (ids: readonly string[]) => void;
  /**
   * Forgets pending marks a document no longer has: undo stepped back past the
   * revision that made them.
   */
  dropUndonePending: (sessionId: string, revision: number) => void;
  /** Asks the main process for an image to stamp; null when nothing was chosen. */
  pickStampImage: () => Promise<StampImage | null>;
}

function activeSessionId(): string | null {
  return useDocumentStore.getState().activeId;
}

function revisionOf(sessionId: string): number | undefined {
  return useDocumentStore.getState().tabs.find((tab) => tab.session.id === sessionId)?.edit
    .revision;
}

function reportFailure(error: unknown): void {
  const serialized = AppError.serialize(error);
  useUiStore.getState().showToast({
    title: serialized.message,
    description: serialized.details,
    intent: 'error',
  });
}

/**
 * Comments and the tool that makes them.
 *
 * The annotations themselves belong to the document, so this store holds only
 * what the reader is doing with them: which tool is active, what a new mark
 * should look like, what is selected, and the list read back after each
 * change. Nothing here is a private copy of the document's data — the list is
 * replaced from the file whenever the revision moves.
 */
export const useAnnotationStore = create<AnnotationStore>((set, get) => ({
  tool: 'select',
  style: DEFAULT_ANNOTATION_STYLE,
  stampLabel: 'Approved',
  pendingText: null,
  annotations: [],
  loadedFor: null,
  loading: false,
  selectedId: null,
  draft: null,
  pending: [],
  sort: 'page',
  filter: DEFAULT_FILTER,

  setTool: (tool) => set({ tool, draft: null, ...(tool === 'select' ? {} : { selectedId: null }) }),
  setStyle: (patch) => set((state) => ({ style: { ...state.style, ...patch } })),
  setStampLabel: (stampLabel) => set({ stampLabel }),
  select: (selectedId) => set({ selectedId }),
  setSort: (sort) => set({ sort }),
  setFilter: (filter) => set((state) => ({ filter: { ...state.filter, ...filter } })),
  setDraft: (draft) => set({ draft }),
  setPendingText: (pendingText) => set({ pendingText }),

  load: async (sessionId, revision) => {
    const loaded = get().loadedFor;
    if (loaded !== null && loaded.sessionId === sessionId && loaded.revision === revision) return;

    set({ loading: true });
    try {
      const annotations = await invoke('annotations:list', { sessionId });
      // A later request may have overtaken this one.
      const current = useDocumentStore.getState();
      const tab = current.tabs.find((candidate) => candidate.session.id === sessionId);
      if (current.activeId !== sessionId || tab?.edit.revision !== revision) return;

      set((state) => ({
        annotations,
        loadedFor: { sessionId, revision },
        // A selection that is no longer in the document is dropped.
        selectedId: annotations.some((annotation) => annotation.id === state.selectedId)
          ? state.selectedId
          : null,
      }));
    } catch (error) {
      reportFailure(error);
      set({ annotations: [], loadedFor: { sessionId, revision } });
    } finally {
      set({ loading: false });
    }
  },

  add: async (inputs) => {
    const sessionId = activeSessionId();
    if (sessionId === null || inputs.length === 0) return;

    const label =
      inputs.length === 1
        ? `Add ${describeInput(inputs[0])}`
        : `Add ${String(inputs.length)} comments`;

    await showWhileWriting(sessionId, inputs, async () => {
      set({ draft: null });
      await useDocumentStore.getState().applyEdit(sessionId, {
        label,
        operations: [{ kind: 'addAnnotations', annotations: [...inputs] }],
      });
    });
  },

  update: async (id, patch, label) => {
    const sessionId = activeSessionId();
    if (sessionId === null) return;

    // A moved mark is shown where it was put, not back where it came from.
    const annotation = get().annotations.find((candidate) => candidate.id === id);
    const moved =
      annotation !== undefined && (patch.geometry !== undefined || patch.rotation !== undefined)
        ? [
            {
              ...annotation,
              geometry: patch.geometry ?? annotation.geometry,
              ...(patch.rotation === undefined && annotation.rotation === undefined
                ? {}
                : { rotation: patch.rotation ?? annotation.rotation }),
            },
          ]
        : [];

    await showWhileWriting(sessionId, moved, () =>
      useDocumentStore.getState().applyEdit(sessionId, {
        label: label ?? 'Change comment',
        operations: [{ kind: 'updateAnnotations', updates: [{ id, patch }] }],
      }),
    );
  },

  transform: async (id, rect, rotation) => {
    const annotation = get().annotations.find((candidate) => candidate.id === id);
    if (annotation === undefined || !('rect' in annotation.geometry)) return;
    const turned = (annotation.rotation ?? 0) !== rotation;
    await get().update(
      id,
      { geometry: { ...annotation.geometry, rect }, rotation },
      `${turned ? 'Rotate' : 'Resize'} ${describeKind(annotation.geometry.kind)}`,
    );
  },

  duplicate: async (id) => {
    const sessionId = activeSessionId();
    const annotation = get().annotations.find((candidate) => candidate.id === id);
    if (sessionId === null || annotation === undefined) return;

    const newId = `pf-${globalThis.crypto.randomUUID()}`;
    const before = revisionOf(sessionId);
    await useDocumentStore.getState().applyEdit(sessionId, {
      label: `Duplicate ${describeKind(annotation.geometry.kind)}`,
      operations: [
        {
          kind: 'duplicateAnnotations',
          copies: [{ id, newId }],
          dx: DUPLICATE_OFFSET,
          dy: -DUPLICATE_OFFSET,
        },
      ],
    });
    // The list is read again for the new revision; the copy is selected then.
    if (revisionOf(sessionId) !== before) set({ selectedId: newId });
  },

  remove: async (ids) => {
    const sessionId = activeSessionId();
    if (sessionId === null || ids.length === 0) return;

    await useDocumentStore.getState().applyEdit(sessionId, {
      label: ids.length === 1 ? 'Delete comment' : 'Delete comments',
      operations: [{ kind: 'deleteAnnotations', ids: [...ids] }],
    });
    set((state) => ({
      selectedId: ids.includes(state.selectedId ?? '') ? null : state.selectedId,
    }));
  },

  settlePending: (ids) => {
    if (ids.length === 0) return;
    set((state) => ({ pending: state.pending.filter((entry) => !ids.includes(entry.id)) }));
  },

  dropUndonePending: (sessionId, revision) => {
    const undone = get().pending.filter(
      (entry) => entry.sessionId === sessionId && entry.madeIn !== null && entry.madeIn > revision,
    );
    if (undone.length > 0) get().settlePending(undone.map((entry) => entry.id));
  },

  pickStampImage: async () => {
    const sessionId = activeSessionId();
    if (sessionId === null) return null;
    try {
      return await invoke('annotations:stageStampImage', { sessionId });
    } catch (error) {
      reportFailure(error);
      return null;
    }
  },
}));

/**
 * Shows marks over the page while `write` puts them into the document. They
 * stay until their page has been redrawn from the revision that holds them, or
 * go at once if nothing was written.
 */
async function showWhileWriting(
  sessionId: string,
  marks: readonly AnnotationInput[],
  write: () => Promise<void>,
): Promise<void> {
  const before = revisionOf(sessionId);
  const entries: PendingAnnotation[] = marks.map((input) => ({
    id: `pending-${String((pendingCounter += 1))}`,
    sessionId,
    input,
    madeIn: null,
  }));
  const ids = new Set(entries.map((entry) => entry.id));
  if (entries.length > 0) {
    useAnnotationStore.setState((state) => ({ pending: [...state.pending, ...entries] }));
  }

  try {
    await write();
  } finally {
    const after = revisionOf(sessionId);
    useAnnotationStore.setState((state) => ({
      pending:
        // The edit failed, or the document closed: there is nothing to wait for.
        after === undefined || after === before
          ? state.pending.filter((entry) => !ids.has(entry.id))
          : state.pending.map((entry) => (ids.has(entry.id) ? { ...entry, madeIn: after } : entry)),
    }));
  }
}

/** Pending marks of one page of one document. */
export function pendingOnPage(
  pending: readonly PendingAnnotation[],
  sessionId: string,
  pageNumber: number,
): PendingAnnotation[] {
  return pending.filter(
    (entry) => entry.sessionId === sessionId && entry.input.pageNumber === pageNumber,
  );
}

/** The annotation the reader has selected, if it is still there. */
export function selectedAnnotation(state: {
  annotations: readonly Annotation[];
  selectedId: string | null;
}): Annotation | null {
  return state.annotations.find((annotation) => annotation.id === state.selectedId) ?? null;
}

/**
 * The annotations of one document, or nothing while another one is loading.
 *
 * The empty case is a shared constant rather than a fresh array: this is read
 * through a store selector, and a new array every time would be a new value
 * every render.
 */
const NO_ANNOTATIONS: readonly Annotation[] = Object.freeze([]);

export function annotationsForSession(
  state: { annotations: readonly Annotation[]; loadedFor: { sessionId: string } | null },
  sessionId: string,
): readonly Annotation[] {
  return state.loadedFor?.sessionId === sessionId ? state.annotations : NO_ANNOTATIONS;
}

/** Annotations of one page, in the order they were added. */
export function annotationsOnPage(
  annotations: readonly Annotation[],
  pageNumber: number,
): Annotation[] {
  return annotations.filter((annotation) => annotation.pageNumber === pageNumber);
}
