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
import { describeKind } from '@pdf/mutate/operations';
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

interface AnnotationStore {
  tool: AnnotationTool;
  /** Style new annotations are created with, and what the properties panel edits. */
  style: AnnotationStyle;
  stampLabel: BuiltInStamp;
  /** Annotations of the active document, as the file records them. */
  annotations: Annotation[];
  /** Which document and revision the list came from. */
  loadedFor: { sessionId: string; revision: number } | null;
  loading: boolean;
  selectedId: string | null;
  /** The free text box being typed into, before it exists in the document. */
  draft: AnnotationInput | null;
  sort: CommentSort;
  filter: CommentFilter;

  setTool: (tool: AnnotationTool) => void;
  setStyle: (patch: Partial<AnnotationStyle>) => void;
  setStampLabel: (label: BuiltInStamp) => void;
  select: (id: string | null) => void;
  setSort: (sort: CommentSort) => void;
  setFilter: (filter: Partial<CommentFilter>) => void;
  setDraft: (draft: AnnotationInput | null) => void;

  /** Reads the annotations of a document revision, once. */
  load: (sessionId: string, revision: number) => Promise<void>;
  /** Adds annotations to the active document as one undoable step. */
  add: (inputs: readonly AnnotationInput[]) => Promise<void>;
  update: (id: string, patch: AnnotationPatch, label?: string) => Promise<void>;
  remove: (ids: readonly string[]) => Promise<void>;
  /** Asks the main process for an image to stamp; null when nothing was chosen. */
  pickStampImage: () => Promise<StampImage | null>;
}

function activeSessionId(): string | null {
  return useDocumentStore.getState().activeId;
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
  annotations: [],
  loadedFor: null,
  loading: false,
  selectedId: null,
  draft: null,
  sort: 'page',
  filter: DEFAULT_FILTER,

  setTool: (tool) => set({ tool, draft: null, ...(tool === 'select' ? {} : { selectedId: null }) }),
  setStyle: (patch) => set((state) => ({ style: { ...state.style, ...patch } })),
  setStampLabel: (stampLabel) => set({ stampLabel }),
  select: (selectedId) => set({ selectedId }),
  setSort: (sort) => set({ sort }),
  setFilter: (filter) => set((state) => ({ filter: { ...state.filter, ...filter } })),
  setDraft: (draft) => set({ draft }),

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
        ? `Add ${describeKind(inputs[0]?.geometry.kind)}`
        : `Add ${String(inputs.length)} comments`;

    await useDocumentStore.getState().applyEdit(sessionId, {
      label,
      operations: [{ kind: 'addAnnotations', annotations: [...inputs] }],
    });
    set({ draft: null });
  },

  update: async (id, patch, label) => {
    const sessionId = activeSessionId();
    if (sessionId === null) return;

    await useDocumentStore.getState().applyEdit(sessionId, {
      label: label ?? 'Change comment',
      operations: [{ kind: 'updateAnnotations', updates: [{ id, patch }] }],
    });
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
