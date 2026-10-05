// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditTransaction, ImagePlacementInput } from '../../../src/shared/schemas/edit';
import type { PageImageModel } from '../../../src/shared/schemas/image';
import type { LinkModel } from '../../../src/shared/schemas/link';
import {
  initialEditState,
  useDocumentStore,
  type DocumentTab,
} from '../../../src/renderer/stores/documentStore';
import { useImageEditStore } from '../../../src/renderer/stores/imageEditStore';
import { useLinkEditStore } from '../../../src/renderer/stores/linkEditStore';
import { useFormStore } from '../../../src/renderer/stores/formStore';

/**
 * Moving an image, a link or a form field keeps it where it was dropped while
 * the document is rewritten, instead of jumping back to where it was until the
 * page has been read and drawn again.
 */

const invoke = vi.hoisted(() => vi.fn());
vi.mock('../../../src/renderer/services/ipcClient', () => ({
  invoke,
  subscribe: vi.fn(() => () => undefined),
}));

const SESSION = 'session-1';

const placed: ImagePlacementInput = {
  x: 120,
  y: 480,
  width: 200,
  height: 100,
  rotation: 0,
  flipX: false,
  flipY: false,
};

const image: PageImageModel = {
  id: 'img-0',
  resourceName: 'Im0',
  placement: placed,
  pixelWidth: 16,
  pixelHeight: 8,
  crop: null,
  opacity: 1,
  hasAlpha: false,
  added: false,
};

const link: LinkModel = {
  id: 'link-0',
  rect: { x: 60, y: 600, width: 100, height: 20 },
  target: { kind: 'page', page: 1 },
} as LinkModel;

/** Lets a test hold an edit in flight. */
let release: (() => void) | null = null;
let applied: EditTransaction[] = [];

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

/** Lets queued promise callbacks run. */
async function settle(): Promise<void> {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

beforeEach(() => {
  applied = [];
  release = null;
  invoke.mockReset();
  // Every page is read back as it was; what matters here is what shows in between.
  invoke.mockImplementation((channel: string) => {
    if (channel === 'images:page') {
      return Promise.resolve({ page: 1, revision: revision(), images: [image] });
    }
    if (channel === 'links:page') {
      return Promise.resolve({ page: 1, revision: revision(), links: [link] });
    }
    if (channel === 'forms:model') return Promise.resolve({ revision: revision(), fields: [] });
    return Promise.resolve(undefined);
  });

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

  useImageEditStore.setState({
    pages: new Map([
      [`${SESSION}:1`, { revision: 0, model: { page: 1, revision: 0, images: [image] } }],
    ]),
    selected: null,
    drag: null,
    pending: null,
    moved: null,
    busy: false,
  });
  useLinkEditStore.setState({
    pages: new Map([
      [`${SESSION}:1`, { revision: 0, model: { page: 1, revision: 0, links: [link] } }],
    ]),
    selected: null,
    drag: null,
    drawing: false,
    drawn: null,
    busy: false,
  });
});

describe('a moved image', () => {
  const to = { ...placed, x: 170 };

  it('keeps its box where it was dropped, and shows its picture there, until redrawn', async () => {
    const picture = document.createElement('canvas');
    useImageEditStore.getState().setDrag({ page: 1, id: 'img-0', placement: to });
    const placing = useImageEditStore.getState().place(1, 'img-0', to, picture);
    await settle();

    expect(useImageEditStore.getState().drag?.placement).toEqual(to);
    expect(useImageEditStore.getState().moved).toMatchObject({
      page: 1,
      from: placed,
      to,
      picture,
      madeIn: null,
    });

    release?.();
    await placing;
    // The images have been read again, so the box comes from them now; the
    // picture stays until the page is drawn from the revision with the move.
    expect(useImageEditStore.getState().drag).toBeNull();
    expect(useImageEditStore.getState().moved?.madeIn).toBe(revision());

    useImageEditStore.getState().settleMoved();
    expect(useImageEditStore.getState().moved).toBeNull();
  });

  it('shows nothing in its place when there is no picture to show', async () => {
    const placing = useImageEditStore.getState().place(1, 'img-0', to);
    await settle();
    expect(useImageEditStore.getState().moved).toBeNull();
    release?.();
    await placing;
  });

  it('goes at once when the change was not written', async () => {
    useDocumentStore.setState({ applyEdit: () => Promise.resolve() });
    await useImageEditStore.getState().place(1, 'img-0', to, document.createElement('canvas'));
    expect(useImageEditStore.getState().moved).toBeNull();
    expect(useImageEditStore.getState().busy).toBe(false);
  });

  it('is covered where it was once deleted, until redrawn', async () => {
    const removing = useImageEditStore.getState().remove(1, 'img-0');
    await settle();
    expect(useImageEditStore.getState().moved).toMatchObject({ from: placed, to: null });
    release?.();
    await removing;
    expect(useImageEditStore.getState().moved?.madeIn).toBe(revision());
  });

  it('goes when undo steps back past the revision that moved it', async () => {
    const placing = useImageEditStore
      .getState()
      .place(1, 'img-0', to, document.createElement('canvas'));
    release?.();
    await placing;

    useImageEditStore.getState().dropUndoneMoved(SESSION, 1);
    expect(useImageEditStore.getState().moved).not.toBeNull();
    useImageEditStore.getState().dropUndoneMoved(SESSION, 0);
    expect(useImageEditStore.getState().moved).toBeNull();
  });
});

describe('a moved link', () => {
  it('keeps its box where it was dropped until the links are read again', async () => {
    const rect = { x: 90, y: 600, width: 100, height: 20 };
    useLinkEditStore.getState().setDrag({ page: 1, id: 'link-0', rect });
    const updating = useLinkEditStore.getState().update(1, 'link-0', { rect });
    await settle();
    expect(useLinkEditStore.getState().drag?.rect).toEqual(rect);

    release?.();
    await updating;
    expect(useLinkEditStore.getState().drag).toBeNull();
  });

  it('shows the area of a new one until it is read back', async () => {
    const rect = { x: 60, y: 300, width: 80, height: 30 };
    const creating = useLinkEditStore.getState().create(1, rect);
    await settle();
    expect(useLinkEditStore.getState().drawn).toEqual({ page: 1, rect });

    release?.();
    await creating;
    expect(useLinkEditStore.getState().drawn).toBeNull();
  });
});

describe('a new form field', () => {
  it('shows the box it was drawn in until the form is read back', async () => {
    useFormStore.setState({
      forms: new Map([[SESSION, { revision: 0, model: { revision: 0, fields: [] } as never }]]),
      fieldTool: 'text',
      drawn: null,
      drag: null,
    });
    const rect = { x: 60, y: 300, width: 140, height: 22 };
    const adding = useFormStore.getState().addField(1, rect);
    await settle();
    expect(useFormStore.getState().drawn).toEqual({ page: 1, rect });

    release?.();
    await adding;
    expect(applied).toHaveLength(1);
    expect(useFormStore.getState().drawn).toBeNull();
  });
});
