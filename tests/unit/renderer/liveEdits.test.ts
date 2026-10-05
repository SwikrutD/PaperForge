// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditTransaction } from '../../../src/shared/schemas/edit';
import type { TextRunModel } from '../../../src/shared/schemas/text';
import {
  DEFAULT_ANNOTATION_STYLE,
  type AnnotationInput,
} from '../../../src/shared/schemas/annotation';
import {
  initialEditState,
  useDocumentStore,
  type DocumentTab,
} from '../../../src/renderer/stores/documentStore';
import { useTextEditStore } from '../../../src/renderer/stores/textEditStore';
import { useAnnotationStore } from '../../../src/renderer/stores/annotationStore';
import { awaitingPaint } from '../../../src/renderer/components/viewer/paintedRevision';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('../../../src/renderer/services/ipcClient', () => ({
  invoke,
  subscribe: vi.fn(() => () => undefined),
}));

const SESSION = 'session-1';

function run(id: string, text: string): TextRunModel {
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
  };
}

/** The edits sent to the main process, which each make a new revision. */
let applied: EditTransaction[] = [];
/** Lets a test hold an edit in flight. */
let release: (() => void) | null = null;

function revision(): number {
  return useDocumentStore.getState().tabs[0]?.edit.revision ?? -1;
}

function bumpRevision(): void {
  useDocumentStore.setState((state) => ({
    tabs: state.tabs.map((tab) => ({
      ...tab,
      edit: { ...tab.edit, revision: tab.edit.revision + 1 },
    })),
  }));
}

beforeEach(() => {
  applied = [];
  release = null;
  invoke.mockReset();
  invoke.mockImplementation((channel: string) =>
    Promise.resolve(channel === 'text:canWrite' ? { ok: true, missing: null } : undefined),
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
      return new Promise<void>((resolve) => {
        release = () => {
          bumpRevision();
          resolve();
        };
      });
    },
  });

  useTextEditStore.setState({
    active: true,
    pages: new Map([
      [
        `${SESSION}:1`,
        {
          revision: 0,
          model: {
            page: 1,
            revision: 0,
            runs: [run('a', 'The first line'), run('b', 'The second line')],
          },
        },
      ],
    ]),
    selected: null,
    draft: null,
    placement: null,
    placing: false,
    busy: false,
    pendingText: null,
  });
  useAnnotationStore.setState({ pending: [], annotations: [], draft: null });
});

/** Lets queued promise callbacks run. */
async function settle(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

describe('text edits', () => {
  it('keeps what was typed when the reader clicks another line', async () => {
    const store = useTextEditStore.getState();
    store.beginEdit(1, 'a');
    store.setDraft('A changed line');

    // Clicking the second line used to drop the draft without writing it.
    useTextEditStore.getState().select(1, 'b');
    await settle();
    release?.();
    await settle();

    expect(applied).toHaveLength(1);
    expect(applied[0]?.operations[0]).toMatchObject({
      kind: 'editText',
      runId: 'a',
      text: 'A changed line',
    });
  });

  it('keeps what was typed when the reader clicks the empty page', async () => {
    useTextEditStore.getState().beginEdit(1, 'a');
    useTextEditStore.getState().setDraft('Changed');
    useTextEditStore.getState().select(1, null);
    await settle();

    expect(applied).toHaveLength(1);
  });

  it('writes a change once, even when Enter and the lost focus both commit it', async () => {
    useTextEditStore.getState().beginEdit(1, 'a');
    useTextEditStore.getState().setDraft('Once');

    const enter = useTextEditStore.getState().commitEdit();
    const blur = useTextEditStore.getState().commitEdit();
    await settle();
    // A third commit while the first is still being written is refused too.
    const late = useTextEditStore.getState().commitEdit();
    release?.();
    await Promise.all([enter, blur, late]);

    expect(applied).toHaveLength(1);
  });

  it('shows the typed words until the page is drawn with them', async () => {
    useTextEditStore.getState().beginEdit(1, 'a');
    useTextEditStore.getState().setDraft('Shown at once');
    const commit = useTextEditStore.getState().commitEdit();
    await settle();

    // While it is being written the field is gone and the words stand in.
    expect(useTextEditStore.getState().draft).toBeNull();
    expect(useTextEditStore.getState().pendingText).toMatchObject({
      text: 'Shown at once',
      madeIn: null,
      fontSize: 18,
      family: 'helvetica',
    });

    release?.();
    await commit;
    expect(useTextEditStore.getState().pendingText?.madeIn).toBe(1);
    expect(awaitingPaint(1, 0)).toBe(true);
    expect(awaitingPaint(1, 1)).toBe(false);
  });

  it('shows nothing pending when the change was not written', async () => {
    useDocumentStore.setState({ applyEdit: () => Promise.resolve() });
    useTextEditStore.getState().beginEdit(1, 'a');
    useTextEditStore.getState().setDraft('Refused');
    await useTextEditStore.getState().commitEdit();

    expect(useTextEditStore.getState().pendingText).toBeNull();
    expect(useTextEditStore.getState().busy).toBe(false);
  });

  it('drops pending text that undo has taken back', () => {
    useTextEditStore.setState({
      pendingText: {
        sessionId: SESSION,
        page: 1,
        x: 0,
        y: 0,
        covers: null,
        text: 'x',
        fontSize: 12,
        family: 'helvetica',
        color: { r: 0, g: 0, b: 0 },
        madeIn: 4,
      },
    });
    useTextEditStore.getState().dropUndonePending(SESSION, 4);
    expect(useTextEditStore.getState().pendingText).not.toBeNull();
    useTextEditStore.getState().dropUndonePending(SESSION, 3);
    expect(useTextEditStore.getState().pendingText).toBeNull();
  });
});

describe('comment marks', () => {
  const highlight: AnnotationInput = {
    pageNumber: 1,
    geometry: { kind: 'highlight', quads: [[60, 718, 180, 718, 60, 696, 180, 696]] },
    style: DEFAULT_ANNOTATION_STYLE,
    contents: '',
    author: 'Tester',
    subject: '',
  };

  it('stays on screen from the gesture until the page is drawn with it', async () => {
    const adding = useAnnotationStore.getState().add([highlight]);
    expect(useAnnotationStore.getState().pending).toHaveLength(1);
    expect(useAnnotationStore.getState().pending[0]?.madeIn).toBeNull();

    release?.();
    await adding;
    const [entry] = useAnnotationStore.getState().pending;
    expect(entry?.madeIn).toBe(revision());

    useAnnotationStore.getState().settlePending([entry?.id ?? '']);
    expect(useAnnotationStore.getState().pending).toHaveLength(0);
  });

  it('goes at once when the edit fails', async () => {
    useDocumentStore.setState({ applyEdit: () => Promise.resolve() });
    await useAnnotationStore.getState().add([highlight]);
    expect(useAnnotationStore.getState().pending).toHaveLength(0);
  });

  it('goes when undo steps back past the revision that made it', async () => {
    const adding = useAnnotationStore.getState().add([highlight]);
    release?.();
    await adding;

    useAnnotationStore.getState().dropUndonePending(SESSION, 1);
    expect(useAnnotationStore.getState().pending).toHaveLength(1);
    useAnnotationStore.getState().dropUndonePending(SESSION, 0);
    expect(useAnnotationStore.getState().pending).toHaveLength(0);
  });
});
