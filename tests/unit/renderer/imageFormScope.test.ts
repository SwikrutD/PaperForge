// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditTransaction, ImagePlacementInput } from '../../../src/shared/schemas/edit';
import type { PageImageModel } from '../../../src/shared/schemas/image';
import {
  initialEditState,
  useDocumentStore,
  type DocumentTab,
} from '../../../src/renderer/stores/documentStore';
import { imagePageStatus, useImageEditStore } from '../../../src/renderer/stores/imageEditStore';
import { useUiStore } from '../../../src/renderer/stores/uiStore';
import { imageHint } from '../../../src/renderer/components/edit/editHints';

/**
 * A picture inside a form the document draws more than once: the editor asks
 * whether a change is for this drawing or for every one, before it makes it.
 * And the edit bar says why, when a page shows pictures it cannot edit.
 */

const invoke = vi.hoisted(() => vi.fn());
vi.mock('../../../src/renderer/services/ipcClient', () => ({
  invoke,
  subscribe: vi.fn(() => () => undefined),
}));

const SESSION = 'session-1';

const placed: ImagePlacementInput = {
  x: 100,
  y: 200,
  width: 80,
  height: 40,
  rotation: 0,
  flipX: false,
  flipY: false,
};

const shared: PageImageModel = {
  id: 'f3-img1',
  resourceName: 'Im0',
  placement: placed,
  pixelWidth: 16,
  pixelHeight: 8,
  crop: null,
  opacity: 1,
  hasAlpha: false,
  added: false,
  source: 'form',
  formUses: 3,
};

let applied: EditTransaction[] = [];

async function settle(): Promise<void> {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

function withImages(images: PageImageModel[]): void {
  useImageEditStore.setState({
    pages: new Map([
      [`${SESSION}:1`, { revision: 0, model: { page: 1, revision: 0, images, skipped: [] } }],
    ]),
    failed: new Map(),
  });
}

beforeEach(() => {
  applied = [];
  invoke.mockReset();
  invoke.mockImplementation((channel: string) =>
    channel === 'images:page'
      ? Promise.resolve({ page: 1, revision: 1, images: [shared], skipped: [] })
      : Promise.resolve(undefined),
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
  useImageEditStore.setState({
    selected: null,
    drag: null,
    pending: null,
    moved: null,
    busy: false,
    cropping: null,
  });
  withImages([shared]);
});

describe('changing a picture in a form drawn more than once', () => {
  it('asks first, and changes every drawing when told to', async () => {
    const moving = useImageEditStore.getState().place(1, shared.id, { ...placed, x: 150 });
    await settle();

    const asked = useUiStore.getState().confirmation;
    expect(asked?.message).toMatch(/3 times/);
    expect(applied).toHaveLength(0);

    asked?.alternative?.onChoose();
    useUiStore.setState({ confirmation: null });
    await moving;

    expect(applied[0]?.operations[0]).toMatchObject({ kind: 'placeImage', scope: 'all' });
  });

  it('changes only this drawing when told to', async () => {
    const removing = useImageEditStore.getState().remove(1, shared.id);
    await settle();
    useUiStore.getState().resolveConfirmation(true);
    await removing;

    expect(applied[0]?.operations[0]).toMatchObject({ kind: 'deleteImage', scope: 'this' });
  });

  it('changes nothing when the question is dismissed', async () => {
    const moving = useImageEditStore.getState().setOpacity(1, shared.id, 0.5);
    await settle();
    useUiStore.getState().resolveConfirmation(false);
    await moving;

    expect(applied).toHaveLength(0);
    expect(useImageEditStore.getState().busy).toBe(false);
    expect(useImageEditStore.getState().moved).toBeNull();
  });

  it('does not ask about a picture drawn once', async () => {
    withImages([{ ...shared, formUses: 1 }]);
    await useImageEditStore.getState().place(1, shared.id, { ...placed, x: 150 });

    expect(useUiStore.getState().confirmation).toBeNull();
    expect(applied[0]?.operations[0]).not.toHaveProperty('scope');
  });
});

describe('the edit bar, about the images on a page', () => {
  const hint = (status: ReturnType<typeof imagePageStatus>): string =>
    imageHint({ pending: null, status, selected: false });

  it('says why when the page shows pictures it cannot edit', () => {
    const text = hint({ state: 'read', count: 0, skipped: ['annotation'] });
    expect(text).not.toMatch(/draws no images/i);
    expect(text).toMatch(/comment|stamp/i);
  });

  it('says the page could not be read, rather than that it has no images', () => {
    const text = hint({
      state: 'failed',
      message: 'PaperForge cannot change an encrypted document yet.',
    });
    expect(text).not.toMatch(/no images/i);
    expect(text).toMatch(/encrypted/);
  });

  it('does not claim a page has no images while it is still being read', () => {
    expect(hint({ state: 'loading' })).not.toMatch(/no images/i);
  });

  it('reads the status from what the store holds', async () => {
    useImageEditStore.setState({ pages: new Map(), failed: new Map() });
    invoke.mockImplementation(() => Promise.reject(new Error('cannot read')));
    await useImageEditStore.getState().load(SESSION, 2, 0);

    const { pages, failed } = useImageEditStore.getState();
    expect(imagePageStatus(pages, failed, SESSION, 2)).toMatchObject({ state: 'failed' });
    expect(imagePageStatus(pages, failed, SESSION, 3)).toEqual({ state: 'loading' });
    expect(imagePageStatus(pages, failed, SESSION, 1)).toEqual({ state: 'loading' });
  });
});
