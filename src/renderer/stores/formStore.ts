import { create } from 'zustand';
import { AppError } from '@shared/errors/appError';
import {
  DEFAULT_FIELD_PROPERTIES,
  type FormFieldModel,
  type FormFieldProperties,
  type FormFieldType,
  type FormModel,
  type FormValue,
} from '@shared/schemas/form';
import { calculate, validate } from '@pdf/forms/rules';
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
  /** True while the form is being made rather than filled in. */
  preparing: boolean;
  /** The kind of field the next drag draws, when one has been chosen. */
  fieldTool: FormFieldType | null;
  /** Where the field being dragged is now, before it is written. */
  drag: { name: string; rect: FieldRect } | null;
  /** The box of a field being made, until the form is read again with it. */
  drawn: { page: number; rect: FieldRect } | null;
  /** Keyed by session id. */
  forms: Map<string, LoadedForm>;
  /** Draws a tint behind every field, so they can be found at a glance. */
  highlight: boolean;
  /** The field the reader is working on, by name. */
  selected: string | null;
  /** What has been typed but not yet written, by field name. */
  drafts: Map<string, FormValue>;
  /** Why a field will not take what was typed, by field name. */
  problems: Map<string, string>;
  busy: boolean;

  setActive: (active: boolean) => void;
  setPreparing: (preparing: boolean) => void;
  setFieldTool: (fieldTool: FormFieldType | null) => void;
  setDrag: (drag: { name: string; rect: FieldRect } | null) => void;
  /** Draws a new field of the chosen kind on a page. */
  addField: (page: number, rect: FieldRect) => Promise<void>;
  /** Changes a field: what it is called, what it accepts, where it sits. */
  updateField: (
    name: string,
    change: {
      newName?: string;
      rect?: FieldRect;
      options?: string[];
      properties: FormFieldProperties;
    },
  ) => Promise<void>;
  /** Moves or resizes a field, keeping everything else about it. */
  moveField: (name: string, rect: FieldRect) => Promise<void>;
  deleteField: (name: string) => Promise<void>;
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
  preparing: false,
  fieldTool: null,
  drag: null,
  drawn: null,
  forms: new Map(),
  highlight: true,
  selected: null,
  drafts: new Map(),
  problems: new Map(),
  busy: false,

  setActive: (active) =>
    set({ active, selected: null, drafts: new Map(), ...(active ? {} : { preparing: false }) }),
  setPreparing: (preparing) => set({ preparing, selected: null, fieldTool: null, drag: null }),
  setFieldTool: (fieldTool) => set({ fieldTool, selected: fieldTool === null ? null : null }),
  setDrag: (drag) => set({ drag }),

  addField: async (page, rect) => {
    const sessionId = useDocumentStore.getState().activeId;
    const kind = get().fieldTool;
    if (sessionId === null || kind === null) return;

    const name = nextFieldName(fieldsOf(get(), sessionId), kind);
    const drawn = { page, rect };
    set({ drawn });
    try {
      await run(sessionId, {
        label: `Add ${name}`,
        operations: [
          {
            kind: 'addFormField',
            page,
            name,
            fieldType: kind,
            rect,
            options:
              kind === 'radio' || kind === 'dropdown' || kind === 'optionList'
                ? ['Option 1', 'Option 2']
                : null,
            properties: DEFAULT_FIELD_PROPERTIES,
          },
        ],
      });
    } finally {
      // The form has been read again by now, so the field itself is there.
      if (get().drawn === drawn) set({ drawn: null });
    }
    set({ selected: name, fieldTool: null });
  },

  updateField: async (name, change) => {
    const sessionId = useDocumentStore.getState().activeId;
    if (sessionId === null) return;

    await run(sessionId, {
      label: `Change ${name}`,
      operations: [
        {
          kind: 'updateFormField',
          name,
          newName: change.newName ?? null,
          rect: change.rect ?? null,
          options: change.options ?? null,
          properties: change.properties,
        },
      ],
    });
    set({ selected: change.newName ?? name });
  },

  moveField: async (name, rect) => {
    const sessionId = useDocumentStore.getState().activeId;
    if (sessionId === null) return;
    const field = fieldOf(get(), sessionId, name);
    if (field === undefined) return;
    const drag = get().drag;

    try {
      await get().updateField(name, { rect, properties: propertiesOf(field) });
    } finally {
      // The box stays where it was dropped until the form is read again.
      if (get().drag === drag) set({ drag: null });
    }
  },

  deleteField: async (name) => {
    const sessionId = useDocumentStore.getState().activeId;
    if (sessionId === null) return;

    await run(sessionId, {
      label: `Delete ${name}`,
      operations: [{ kind: 'deleteFormField', name }],
    });
    set({ selected: null });
  },
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

    const problem = validate(field.rule, field.type, next);
    if (problem !== null) {
      set((state) => {
        const problems = new Map(state.problems);
        problems.set(name, problem);
        return { problems };
      });
      return;
    }
    clearProblem(name);

    const values = [
      { name, value: next },
      ...calculationsFor(fieldsOf(get(), sessionId), new Map([[name, next]])),
    ];

    await run(sessionId, {
      label:
        values.length === 1 ? `Fill ${field.name}` : `Fill ${field.name} and work out the rest`,
      operations: [{ kind: 'setFieldValues', values }],
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

/** A box a field is drawn in, in PDF user space. */
export interface FieldRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A name no field has yet, of the form `text1`, `checkbox2`… */
function nextFieldName(fields: readonly FormFieldModel[], kind: FormFieldType): string {
  const used = new Set(fields.map((field) => field.name));
  let index = 1;
  while (used.has(`${kind}${String(index)}`)) index += 1;
  return `${kind}${String(index)}`;
}

/** What a field would hold if nothing else were said. */
export function propertiesOf(field: FormFieldModel): FormFieldProperties {
  return {
    tooltip: field.tooltip,
    required: field.required,
    readOnly: field.readOnly,
    multiline: field.multiline,
    password: field.password,
    maxLength: field.maxLength,
    alignment: field.alignment ?? 'left',
    fontSize: field.fontSize,
    defaultValue: null,
    label: null,
    rule: field.rule,
  };
}

/**
 * The fields that work something out, with what they now come to.
 *
 * PaperForge does the arithmetic itself, once, and writes the answers beside
 * the value the reader typed — so a total is part of the same change, and the
 * same undo.
 */
export function calculationsFor(
  fields: readonly FormFieldModel[],
  changed: ReadonlyMap<string, FormValue | null>,
): Array<{ name: string; value: FormValue }> {
  const valueOf = (name: string): FormValue | null => {
    if (changed.has(name)) return changed.get(name) ?? null;
    return fields.find((field) => field.name === name)?.value ?? null;
  };

  const results: Array<{ name: string; value: FormValue }> = [];
  for (const field of fields) {
    if (field.rule.calculation === null || field.readOnly) continue;
    const worked = calculate(field.rule, valueOf);
    if (worked === null) continue;
    if (String(field.value ?? '') === worked) continue;
    results.push({ name: field.name, value: worked });
  }
  return results;
}

function clearProblem(name: string): void {
  useFormStore.setState((state) => {
    if (!state.problems.has(name)) return state;
    const problems = new Map(state.problems);
    problems.delete(name);
    return { ...state, problems };
  });
}

function clearDraft(name: string): void {
  useFormStore.setState((state) => {
    if (!state.drafts.has(name)) return state;
    const drafts = new Map(state.drafts);
    drafts.delete(name);
    return { ...state, drafts };
  });
}

/**
 * Changes go one at a time, and the model is read again before the next one.
 *
 * A form is filled in field by field, and a total is worked out from what the
 * other fields hold: two changes in flight at once would each work from what
 * the form held before the other, and the later answer would be wrong.
 */
let queue: Promise<void> = Promise.resolve();

async function run(
  sessionId: string,
  transaction: Parameters<ReturnType<typeof useDocumentStore.getState>['applyEdit']>[1],
): Promise<void> {
  queue = queue.then(async () => {
    useFormStore.setState({ busy: true });
    try {
      await useDocumentStore.getState().applyEdit(sessionId, transaction);
      const revision = useDocumentStore.getState().tabs.find((tab) => tab.session.id === sessionId)
        ?.edit.revision;
      if (revision !== undefined) await useFormStore.getState().load(sessionId, revision);
    } finally {
      useFormStore.setState({ busy: false });
    }
  });
  await queue;
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
