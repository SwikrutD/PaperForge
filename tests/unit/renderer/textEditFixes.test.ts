// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditTransaction } from '../../../src/shared/schemas/edit';
import type { TextRunModel } from '../../../src/shared/schemas/text';
import {
  initialEditState,
  useDocumentStore,
  type DocumentTab,
} from '../../../src/renderer/stores/documentStore';
import { useTextEditStore } from '../../../src/renderer/stores/textEditStore';
import { useUiStore } from '../../../src/renderer/stores/uiStore';

/**
 * The text editor's decisions before anything is written: what it refuses,
 * what it warns about, and which style a change is written with.
 */

const invoke = vi.hoisted(() => vi.fn());
vi.mock('../../../src/renderer/services/ipcClient', () => ({
  invoke,
  subscribe: vi.fn(() => () => undefined),
}));

const SESSION = 'session-1';

function run(id: string, text: string, overrides: Partial<TextRunModel> = {}): TextRunModel {
  return {
    id,
    text,
    x: 60,
    y: 696,
    width: 120,
    height: 18,
    baselineX: 60,
    baselineY: 700,
    rotation: 0,
    fontName: 'F1',
    baseFont: 'Helvetica',
    fontSize: 18,
    color: { r: 0, g: 0, b: 0 },
    invisible: false,
    editable: true,
    reason: null,
    replaced: false,
    ...overrides,
  };
}

let applied: EditTransaction[] = [];

function load(runs: TextRunModel[]): void {
  useTextEditStore.setState({
    pages: new Map([[`${SESSION}:1`, { revision: 0, model: { page: 1, revision: 0, runs } }]]),
  });
}

beforeEach(() => {
  applied = [];
  invoke.mockReset();
  invoke.mockImplementation((channel: string) =>
    Promise.resolve(channel === 'text:canWrite' ? { ok: false, missing: 'x' } : undefined),
  );

  const tab = {
    session: { id: SESSION },
    edit: initialEditState(SESSION),
  } as unknown as DocumentTab;
  useDocumentStore.setState({
    tabs: [tab],
    activeId: SESSION,
    applyEdit: (_sessionId: string, transaction: EditTransaction) => {
      applied.push(transaction);
      return Promise.resolve();
    },
  });
  useUiStore.setState({ toasts: [], confirmation: null });
  useTextEditStore.setState({
    active: true,
    selected: null,
    draft: null,
    placement: null,
    placing: false,
    busy: false,
    pendingText: null,
  });
  load([run('a', 'Original words', { editable: false })]);
});

function lastToast(): { title: string; intent?: string } | undefined {
  return useUiStore.getState().toasts.at(-1);
}

describe('characters the standard fonts cannot draw', () => {
  it('are refused when adding text, with a warning that names them, keeping the draft', async () => {
    const store = useTextEditStore.getState();
    store.placeText({ page: 1, x: 100, y: 200 });
    store.setDraft('Hello Привет');
    await useTextEditStore.getState().commitEdit();

    expect(applied).toHaveLength(0);
    expect(lastToast()?.title).toContain('П');
    expect(useTextEditStore.getState().draft).toBe('Hello Привет');
  });

  it('are refused when replacing text, keeping the draft so it can be corrected', async () => {
    useTextEditStore.getState().beginEdit(1, 'a');
    useTextEditStore.getState().setDraft('Привет');
    await useTextEditStore.getState().commitEdit();

    expect(applied).toHaveLength(0);
    expect(lastToast()?.title).toContain('П');
    expect(useTextEditStore.getState().draft).toBe('Привет');
  });
});

describe('characters neither font can draw', () => {
  it('are refused before the reader is offered a replacement', async () => {
    load([run('a', 'Original words', { editable: true })]);
    invoke.mockImplementation((channel: string) =>
      Promise.resolve(channel === 'text:canWrite' ? { ok: false, missing: 'Ж' } : undefined),
    );
    useTextEditStore.getState().beginEdit(1, 'a');
    useTextEditStore.getState().setDraft('Жук');
    await useTextEditStore.getState().commitEdit();

    expect(useUiStore.getState().confirmation).toBeNull();
    expect(lastToast()?.title).toContain('Ж');
  });
});

describe('WinAnsi punctuation', () => {
  it('is written as typed when adding text', async () => {
    useTextEditStore.getState().placeText({ page: 1, x: 100, y: 200 });
    useTextEditStore.getState().setDraft('It’s “done” – €5 •');
    await useTextEditStore.getState().commitEdit();

    expect(applied[0]?.operations[0]).toMatchObject({
      kind: 'addText',
      text: 'It’s “done” – €5 •',
    });
  });

  it('is written as typed when replacing text', async () => {
    useTextEditStore.getState().beginEdit(1, 'a');
    useTextEditStore.getState().setDraft('It’s “done” — really…');
    await useTextEditStore.getState().commitEdit();

    expect(applied[0]?.operations[0]).toMatchObject({
      kind: 'replaceText',
      text: 'It’s “done” — really…',
    });
  });
});
