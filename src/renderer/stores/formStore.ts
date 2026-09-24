import { create } from 'zustand';
import { AppError } from '@shared/errors/appError';
import type { FormFieldModel, FormModel, FormValue } from '@shared/schemas/form';
import { invoke } from '../services/ipcClient';
import { useDocumentStore } from './documentStore';
import { useUiStore } from './uiStore';

/** The form of one document, once it has been read. */
export interface LoadedForm {
  model: FormModel;
  /** The revision it was read from; a later one makes it stale. */
  revision: number;
}

export interface FormStore {
  /** True while Fill & Sign is on. */
  active: boolean;
  /** Keyed by session id. */
  forms: Map<string, LoadedForm>;
  /** Draws a tint behind every field, so they can be found at a glance. */
  highlight: boolean;
  /** The field the reader is working on, by name. */
  selected: string | null;
  /** What has been typed but not yet written, by field name. */
  drafts: Map<string, FormValue>;
  busy: boolean;

  setActive: (active: boolean) => void;
  setHighlight: (highlight: boolean) => void;
  load: (sessionId: string, revision: number) => Promise<void>;
  select: (name: string | null) => void;
  /** Holds what is being typed without writing it to the document yet. */
  setDraft: (name: string, value: FormValue) => void;
  /** Writes one field, as one undoable change. */
  commit: (name: string, value?: FormValue) => Promise<void>;
  /** Writes whatever has been typed and not yet written. */
  commitDrafts: () => Promise<void>;
  /** Empties every field the reader is allowed to change. */
  clearAll: () => Promise<void>;
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
 * Fill & Sign's own state.
 *
 * What is typed is held here until the field is left: every change to the
 * document makes a new revision and redraws the page, so committing on each
 * keystroke would be both slow and a hundred undo steps for one sentence.
 */
export const useFormStore = create<FormStore>((set, get) => ({
  active: false,
  forms: new Map(),
  highlight: true,
  selected: null,
  drafts: new Map(),
  busy: false,

  setActive: (active) => set({ active, selected: null, drafts: new Map() }),
  setHighlight: (highlight) => set({ highlight }),

  load: async (sessionId, revision) => {
    const existing = get().forms.get(sessionId);
    if (existing !== undefined && existing.revision === revision) return;

    try {
      const model = await invoke('forms:model', { sessionId });
      set((state) => {
        const forms = new Map(state.forms);
        forms.set(sessionId, { model, revision: model.revision });
        // What was typed belongs to the revision it was typed against.
        return { forms, drafts: new Map() };
      });
    } catch (error) {
      report(error);
    }
  },

  select: (name) => set({ selected: name }),

  setDraft: (name, value) =>
    set((state) => {
      const drafts = new Map(state.drafts);
      drafts.set(name, value);
      return { drafts };
    }),

  commit: async (name, value) => {
    const sessionId = useDocumentStore.getState().activeId;
    if (sessionId === null) return;

    const next = value ?? get().drafts.get(name);
    if (next === undefined) return;
    // A tick or a choice shows at once: the document takes a moment to be
    // rewritten and read back, and a control that waits for it feels broken.
    if (value !== undefined) get().setDraft(name, value);

    const field = fieldOf(get(), sessionId, name);
    if (field === undefined || field.readOnly) return;
    if (same(field.value, next)) {
      clearDraft(name);
      return;
    }

    await run(sessionId, {
      label: `Fill ${field.name}`,
      operations: [{ kind: 'setFieldValues', values: [{ name, value: next }] }],
    });
    clearDraft(name);
  },

  commitDrafts: async () => {
    const sessionId = useDocumentStore.getState().activeId;
    const { drafts } = get();
    if (sessionId === null || drafts.size === 0) return;

    const values = [...drafts.entries()]
      .map(([name, value]) => ({ name, value, field: fieldOf(get(), sessionId, name) }))
      .filter((entry) => entry.field !== undefined && !entry.field.readOnly)
      .filter((entry) => !same(entry.field?.value ?? null, entry.value))
      .map((entry) => ({ name: entry.name, value: entry.value }));

    set({ drafts: new Map() });
    if (values.length === 0) return;

    await run(sessionId, {
      label: values.length === 1 ? `Fill ${values[0]?.name ?? 'field'}` : 'Fill in the form',
      operations: [{ kind: 'setFieldValues', values }],
    });
  },

  clearAll: async () => {
    const sessionId = useDocumentStore.getState().activeId;
    if (sessionId === null) return;

    const fields = fieldsOf(get(), sessionId).filter(
      (field) => !field.readOnly && field.type !== 'button' && field.type !== 'signature',
    );
    if (fields.length === 0) return;

    set({ drafts: new Map() });
    await run(sessionId, {
      label: 'Empty the form',
      operations: [
        {
          kind: 'setFieldValues',
          values: fields.map((field) => ({
            name: field.name,
            value: field.type === 'checkbox' ? false : field.type === 'text' ? '' : [],
          })),
        },
      ],
    });
  },
}));

function clearDraft(name: string): void {
  useFormStore.setState((state) => {
    if (!state.drafts.has(name)) return state;
    const drafts = new Map(state.drafts);
    drafts.delete(name);
    return { ...state, drafts };
  });
}

async function run(
  sessionId: string,
  transaction: Parameters<ReturnType<typeof useDocumentStore.getState>['applyEdit']>[1],
): Promise<void> {
  useFormStore.setState({ busy: true });
  try {
    await useDocumentStore.getState().applyEdit(sessionId, transaction);
  } finally {
    useFormStore.setState({ busy: false });
  }
}

/** Whether two field values mean the same thing. */
function same(left: FormValue | null, right: FormValue | null): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    const first = Array.isArray(left) ? left : left === null || left === '' ? [] : [String(left)];
    const second = Array.isArray(right)
      ? right
      : right === null || right === ''
        ? []
        : [String(right)];
    return first.length === second.length && first.every((value, index) => value === second[index]);
  }
  return left === right;
}

function fieldOf(store: FormStore, sessionId: string, name: string): FormFieldModel | undefined {
  return store.forms.get(sessionId)?.model.fields.find((field) => field.name === name);
}

function fieldsOf(store: FormStore, sessionId: string): readonly FormFieldModel[] {
  return store.forms.get(sessionId)?.model.fields ?? NO_FIELDS;
}

/** The fields of a document, or none while it is still being read. */
export function formFieldsFor(
  forms: ReadonlyMap<string, LoadedForm>,
  sessionId: string | null,
): readonly FormFieldModel[] {
  if (sessionId === null) return NO_FIELDS;
  return forms.get(sessionId)?.model.fields ?? NO_FIELDS;
}

/** The fields drawn on one page, with the widget that draws each. */
export function fieldsOnPage(
  fields: readonly FormFieldModel[],
  page: number,
): Array<{ field: FormFieldModel; widgetIndex: number }> {
  const found: Array<{ field: FormFieldModel; widgetIndex: number }> = [];
  for (const field of fields) {
    for (const [widgetIndex, widget] of field.widgets.entries()) {
      if (widget.page === page) found.push({ field, widgetIndex });
    }
  }
  return found;
}

/** What a field is worth right now: what has been typed, else what it holds. */
export function valueOf(
  drafts: ReadonlyMap<string, FormValue>,
  field: FormFieldModel,
): FormValue | null {
  return drafts.get(field.name) ?? field.value;
}

/** The fields that must be filled in and are not. */
export function missingRequired(fields: readonly FormFieldModel[]): FormFieldModel[] {
  return fields.filter((field) => {
    if (!field.required || field.readOnly) return false;
    if (field.type === 'checkbox') return field.value !== true;
    if (Array.isArray(field.value)) return field.value.length === 0;
    return field.value === null || field.value === '';
  });
}

const NO_FIELDS: readonly FormFieldModel[] = Object.freeze([]);
