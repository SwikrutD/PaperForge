// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditTransaction, ImagePlacementInput } from '../../../src/shared/schemas/edit';
import type { PageImageModel } from '../../../src/shared/schemas/image';
import {
  initialEditState,
  useDocumentStore,
  type DocumentTab,
} from '../../../src/renderer/stores/documentStore';
import { useImageEditStore } from '../../../src/renderer/stores/imageEditStore';
import { useUiStore } from '../../../src/renderer/stores/uiStore';

/**
 * What the image editor does with the reader's keys and clicks: paste a
 * picture, nudge one, crop one on the page, cut one down — each as exactly one
 * undoable change, and never two at once.
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
  source: 'page',
  formUses: 1,
};

const STAGED = { token: 'image-1', fileName: 'Pasted image.png', width: 120, height: 60 };

let applied: EditTransaction[] = [];
/** The images a page is read back as, after each change. */
let pageImages: PageImageModel[] = [image];
/** Holds the next edit in flight until released. */
let hold = false;
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

async function settle(): Promise<void> {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

beforeEach(() => {
  applied = [];
  pageImages = [image];
  hold = false;
  release = null;
  invoke.mockReset();
  invoke.mockImplementation((channel: string) => {
    if (channel === 'images:page') {
      return Promise.resolve({ page: 1, revision: revision(), images: pageImages });
    }
    if (channel === 'images:paste') return Promise.resolve(STAGED);
    if (channel === 'images:cut') {
      return Promise.resolve({
        image: { ...STAGED, token: 'image-cut' },
        crop: { x: 0.25, y: 0, width: 0.5, height: 1 },
      });
    }
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
      if (!hold) {
        bumpRevision();
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        release = () => {
          bumpRevision();
          resolve();
        };
      });
    },
  });
  useUiStore.setState({ toasts: [] });
  useImageEditStore.setState({
    pages: new Map([
      [
        `${SESSION}:1`,
        { revision: 0, model: { page: 1, revision: 0, images: [image], skipped: [] } },
      ],
    ]),
    selected: null,
    drag: null,
    pending: null,
    moved: null,
    busy: false,
    cropping: null,
  });
});

describe('pasting a picture', () => {
  it('adds it centred where the reader is looking, and leaves it selected', async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === 'images:paste') return Promise.resolve(STAGED);
      if (channel === 'images:page') {
        const added = applied[0]?.operations[0];
        const id = added?.kind === 'addImage' ? (added.imageId ?? '') : '';
        return Promise.resolve({
          page: 2,
          revision: revision(),
          images: [{ ...image, id, placement: { ...placed, x: 240, y: 370 }, added: true }],
        });
      }
      return Promise.resolve(undefined);
    });

    await useImageEditStore.getState().paste(2, { x: 300, y: 400 });

    expect(applied).toHaveLength(1);
    const operation = applied[0]?.operations[0];
    expect(operation).toMatchObject({
      kind: 'addImage',
      page: 2,
      token: 'image-1',
      placement: { x: 240, y: 370, width: 120, height: 60, rotation: 0 },
    });
    const id = operation?.kind === 'addImage' ? operation.imageId : undefined;
    expect(id).toMatch(/^pf-/);
    expect(useImageEditStore.getState().selected).toEqual({ page: 2, id });
  });

  it('says so, and changes nothing, when the clipboard holds no picture', async () => {
    invoke.mockImplementation((channel: string) =>
      Promise.resolve(channel === 'images:paste' ? null : undefined),
    );

    await useImageEditStore.getState().paste(1, { x: 300, y: 400 });

    expect(applied).toHaveLength(0);
    expect(useUiStore.getState().toasts[0]?.title).toMatch(/no picture/i);
  });
});

describe('one change at a time', () => {
  it('ignores a second change while the first is being written', async () => {
    hold = true;
    const first = useImageEditStore.getState().place(1, 'img-0', { ...placed, x: 150 });
    await settle();

    await useImageEditStore.getState().place(1, 'img-0', { ...placed, x: 190 });
    await useImageEditStore.getState().remove(1, 'img-0');
    await useImageEditStore.getState().replace(1, 'img-0');
    await useImageEditStore.getState().paste(1, { x: 0, y: 0 });

    expect(applied).toHaveLength(1);
    expect(invoke).not.toHaveBeenCalledWith('images:choose', expect.anything());
    release?.();
    await first;
    expect(useImageEditStore.getState().busy).toBe(false);
  });
});

describe('nudging with the arrow keys', () => {
  it('shows each nudge at once and writes them all as one change', async () => {
    useImageEditStore.getState().select(1, 'img-0');
    useImageEditStore.getState().nudge(1, 0);
    useImageEditStore.getState().nudge(1, 0);
    useImageEditStore.getState().nudge(0, -10);

    expect(useImageEditStore.getState().drag?.placement).toMatchObject({ x: 102, y: 190 });
    expect(applied).toHaveLength(0);

    await useImageEditStore.getState().commitNudge();
    expect(applied).toHaveLength(1);
    expect(applied[0]?.operations[0]).toMatchObject({
      kind: 'placeImage',
      imageId: 'img-0',
      placement: { x: 102, y: 190 },
    });
  });

  it('does nothing with nothing selected', async () => {
    useImageEditStore.getState().nudge(1, 0);
    await useImageEditStore.getState().commitNudge();
    expect(applied).toHaveLength(0);
  });
});

describe('cropping on the page', () => {
  it('starts from the crop the picture has, and writes the one dragged to', async () => {
    useImageEditStore.getState().select(1, 'img-0');
    useImageEditStore.getState().beginCrop();
    expect(useImageEditStore.getState().cropping).toEqual({
      page: 1,
      id: 'img-0',
      crop: { x: 0, y: 0, width: 1, height: 1 },
    });

    useImageEditStore.getState().setCropDraft({ x: 0.1, y: 0.2, width: 0.5, height: 0.6 });
    await useImageEditStore.getState().applyCrop();

    expect(applied).toHaveLength(1);
    expect(applied[0]?.operations[0]).toMatchObject({
      kind: 'placeImage',
      imageId: 'img-0',
      placement: placed,
      crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.6 },
    });
    expect(useImageEditStore.getState().cropping).toBeNull();
  });

  it('writes nothing when the crop is cancelled', () => {
    useImageEditStore.getState().select(1, 'img-0');
    useImageEditStore.getState().beginCrop();
    useImageEditStore.getState().setCropDraft({ x: 0.1, y: 0.2, width: 0.5, height: 0.6 });
    useImageEditStore.getState().cancelCrop();
    expect(useImageEditStore.getState().cropping).toBeNull();
    expect(applied).toHaveLength(0);
  });

  it('cuts the picture down for good, into the part of its box that showed', async () => {
    useImageEditStore.getState().select(1, 'img-0');
    useImageEditStore.getState().beginCrop();
    useImageEditStore.getState().setCropDraft({ x: 0.3, y: 0, width: 0.4, height: 1 });
    await useImageEditStore.getState().applyCrop({ cut: true });

    expect(invoke).toHaveBeenCalledWith('images:cut', {
      sessionId: SESSION,
      page: 1,
      imageId: 'img-0',
      crop: { x: 0.3, y: 0, width: 0.4, height: 1 },
    });
    expect(applied).toHaveLength(1);
    // The cut came back rounded to whole pixels; the box is the part it covers.
    expect(applied[0]?.operations[0]).toMatchObject({
      kind: 'placeImage',
      token: 'image-cut',
      crop: null,
      placement: { x: 120, y: 200, width: 40, height: 40 },
    });
  });
});

describe('an image PaperForge added', () => {
  it('is selected again by its name, wherever it ends up', async () => {
    const added: PageImageModel = { ...image, id: 'pf-keep', added: true };
    useImageEditStore.setState({
      pages: new Map([
        [
          `${SESSION}:1`,
          { revision: 0, model: { page: 1, revision: 0, images: [added, image], skipped: [] } },
        ],
      ]),
    });
    // Read back after the move with the other picture now nearer the drop.
    pageImages = [{ ...added, placement: { ...placed, x: 400 } }, image];

    useImageEditStore.getState().select(1, 'pf-keep');
    await useImageEditStore.getState().place(1, 'pf-keep', placed);

    expect(useImageEditStore.getState().selected).toEqual({ page: 1, id: 'pf-keep' });
  });
});
