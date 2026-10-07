import { create } from 'zustand';
import { AppError } from '@shared/errors/appError';
import type { StampImage } from '@shared/schemas/annotation';
import type { EditOperation, ImagePlacementInput, ImageScope } from '@shared/schemas/edit';
import type { PageImageModel, PageImagesModel, SkippedImageReason } from '@shared/schemas/image';
import { invoke } from '../services/ipcClient';
import { useDocumentStore } from './documentStore';
import { useUiStore } from './uiStore';
import { createImageTools, type ImageCropping, type ImageTools } from './imageEditTools';

/** The images of one page, once they have been read. */
export interface LoadedImagePage {
  model: PageImagesModel;
  /** The revision they were read from; a later one makes them stale. */
  revision: number;
}

/** What the reader is dragging, while they are dragging it. */
export interface ImageDrag {
  page: number;
  id: string;
  placement: ImagePlacementInput;
}

/**
 * An image that has just been moved, resized or deleted, shown as it now is
 * until its page has been drawn from the revision that holds the change.
 */
export interface MovedImage {
  sessionId: string;
  page: number;
  /** Where the page still draws it, which the stand-in covers. */
  from: ImagePlacementInput;
  /** Where it now goes, or null when it was deleted. */
  to: ImagePlacementInput | null;
  /** Its pixels as the page showed them, upright in its own axes. */
  picture: HTMLCanvasElement | null;
  /** The revision holding the change; null while it is being written. */
  madeIn: number | null;
}

export interface ImageEditStore extends ImageTools {
  /** Keyed by `${sessionId}:${page}`. */
  pages: Map<string, LoadedImagePage>;
  /** Pages whose images could not be read, with what went wrong; same keys. */
  failed: Map<string, string>;
  selected: { page: number; id: string } | null;
  /** Where the image being dragged is now, before it is written. */
  drag: ImageDrag | null;
  /** An image staged and waiting for the reader to say where it goes. */
  pending: StampImage | null;
  /** An image just moved or deleted, until its page is drawn with the change. */
  moved: MovedImage | null;
  /** The crop being dragged on the page, before it is written. */
  cropping: ImageCropping | null;
  /** True while a change is being made; no other is started until it is done. */
  busy: boolean;

  /** Puts down whatever was being held, when the editor points elsewhere. */
  reset: () => void;
  load: (sessionId: string, page: number, revision: number) => Promise<void>;
  select: (page: number, id: string | null) => void;
  setDrag: (drag: ImageDrag | null) => void;

  /**
   * Writes a new placement for an image, keeping whatever crop it has.
   * `picture` is the image as the page showed it, drawn at its new place
   * until the page is drawn again.
   */
  place: (
    page: number,
    id: string,
    placement: ImagePlacementInput,
    picture?: HTMLCanvasElement | null,
  ) => Promise<void>;
  /** Writes how see-through an image is, keeping everything else. */
  setOpacity: (page: number, id: string, opacity: number) => Promise<void>;
  /** Writes a new crop for an image, keeping where it sits. */
  crop: (
    page: number,
    id: string,
    crop: { x: number; y: number; width: number; height: number } | null,
  ) => Promise<void>;
  /** Picks an image file and draws it in place of the selected one. */
  replace: (page: number, id: string) => Promise<void>;
  remove: (page: number, id: string) => Promise<void>;
  /** Writes the selected image out to a file the reader chooses. */
  exportImage: (page: number, id: string) => Promise<void>;

  /** Picks an image file to add, which the reader then places on a page. */
  choose: () => Promise<void>;
  cancelPending: () => void;
  /** Forgets the moved image once its page shows it. */
  settleMoved: () => void;
  /** Forgets a move that undo has taken back out of the document. */
  dropUndoneMoved: (sessionId: string, revision: number) => void;
  /** Draws the staged image with its top-left corner at a point on a page. */
  addAt: (page: number, x: number, y: number) => Promise<void>;
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
 * The image editor's own state: which page's images have been read, which one
 * is selected, and what is being dragged.
 *
 * As with text, the model belongs to a revision: every change rewrites the
 * page's content, so the page is read again afterwards rather than patched.
 */
export const useImageEditStore = create<ImageEditStore>((set, get) => ({
  pages: new Map(),
  failed: new Map(),
  selected: null,
  drag: null,
  pending: null,
  moved: null,
  cropping: null,
  busy: false,

  reset: () => set({ selected: null, drag: null, pending: null, cropping: null }),

  load: async (sessionId, page, revision) => {
    const key = keyOf(sessionId, page);
    const existing = get().pages.get(key);
    if (existing !== undefined && existing.revision === revision) return;

    try {
      const model = await invoke('images:page', { sessionId, page });
      set((state) => {
        const pages = new Map(state.pages);
        pages.set(key, { model, revision: model.revision });
        const failed = new Map(state.failed);
        failed.delete(key);
        return { pages, failed };
      });
    } catch (error) {
      // Kept, so the edit bar can say the page could not be read rather than
      // that it has no images.
      const { message } = AppError.serialize(error);
      set((state) => ({ failed: new Map(state.failed).set(key, message) }));
      report(error);
    }
  },

  select: (page, id) =>
    set({ selected: id === null ? null : { page, id }, drag: null, cropping: null }),
  setDrag: (drag) => set({ drag }),

  place: async (page, id, placement, picture = null) => {
    const sessionId = useDocumentStore.getState().activeId;
    if (sessionId === null) return;
    const image = imageOf(get(), sessionId, page, id);
    const drag = get().drag;

    try {
      await exclusive(() =>
        run(
          sessionId,
          {
            label: 'Move image',
            operations: [
              {
                kind: 'placeImage',
                page,
                imageId: id,
                placement,
                crop: image?.crop ?? null,
                opacity: image?.opacity ?? 1,
                token: null,
              },
            ],
          },
          // Without the picture there is nothing to show where it goes, and
          // covering where it was would only make it vanish for a moment.
          image === undefined || picture === null
            ? null
            : { page, from: image.placement, to: placement, picture },
        ).then(() => reselect(sessionId, page, placement, id)),
      );
    } finally {
      // The box stays where it was dropped until the images are read again.
      if (get().drag === drag) set({ drag: null });
    }
  },

  setOpacity: async (page, id, opacity) => {
    const sessionId = useDocumentStore.getState().activeId;
    if (sessionId === null) return;
    const image = imageOf(get(), sessionId, page, id);
    if (image === undefined) return;

    await exclusive(async () => {
      await run(sessionId, {
        label: 'Image transparency',
        operations: [
          {
            kind: 'placeImage',
            page,
            imageId: id,
            placement: image.placement,
            crop: image.crop,
            opacity,
            token: null,
          },
        ],
      });
      await reselect(sessionId, page, image.placement, id);
    });
  },

  crop: async (page, id, crop) => {
    const sessionId = useDocumentStore.getState().activeId;
    if (sessionId === null) return;
    const image = imageOf(get(), sessionId, page, id);
    if (image === undefined) return;

    await exclusive(async () => {
      await run(sessionId, {
        label: crop === null ? 'Reset crop' : 'Crop image',
        operations: [
          {
            kind: 'placeImage',
            page,
            imageId: id,
            placement: image.placement,
            crop,
            opacity: image.opacity,
            token: null,
          },
        ],
      });
      await reselect(sessionId, page, image.placement, id);
    });
  },

  replace: async (page, id) => {
    const sessionId = useDocumentStore.getState().activeId;
    if (sessionId === null) return;
    const image = imageOf(get(), sessionId, page, id);
    if (image === undefined) return;

    await exclusive(async () => {
      let staged: StampImage | null;
      try {
        staged = await invoke('images:choose', { sessionId });
      } catch (error) {
        report(error);
        return;
      }
      if (staged === null) return;

      await run(sessionId, {
        label: 'Replace image',
        operations: [
          {
            kind: 'placeImage',
            page,
            imageId: id,
            placement: image.placement,
            crop: image.crop,
            opacity: image.opacity,
            token: staged.token,
          },
        ],
      });
      await reselect(sessionId, page, image.placement, id);
    });
  },

  remove: async (page, id) => {
    const sessionId = useDocumentStore.getState().activeId;
    if (sessionId === null) return;
    const image = imageOf(get(), sessionId, page, id);

    await exclusive(async () => {
      await run(
        sessionId,
        {
          label: 'Delete image',
          operations: [{ kind: 'deleteImage', page, imageId: id }],
        },
        image === undefined ? null : { page, from: image.placement, to: null, picture: null },
      );
      set({ selected: null });
    });
  },

  exportImage: async (page, id) => {
    const sessionId = useDocumentStore.getState().activeId;
    if (sessionId === null) return;

    await exclusive(async () => {
      try {
        const result = await invoke('images:export', { sessionId, page, imageId: id });
        const written = result.paths[0];
        if (result.canceled || written === undefined) return;
        useUiStore.getState().showToast({
          title: 'Image saved.',
          description: written,
          intent: 'success',
        });
      } catch (error) {
        report(error);
      }
    });
  },

  choose: async () => {
    const sessionId = useDocumentStore.getState().activeId;
    if (sessionId === null) return;
    try {
      const staged = await invoke('images:choose', { sessionId });
      if (staged !== null) set({ pending: staged, selected: null });
    } catch (error) {
      report(error);
    }
  },

  cancelPending: () => set({ pending: null }),

  settleMoved: () => set({ moved: null }),

  dropUndoneMoved: (sessionId, revision) => {
    const moved = get().moved;
    if (moved?.sessionId === sessionId && moved.madeIn !== null && moved.madeIn > revision) {
      set({ moved: null });
    }
  },

  addAt: async (page, x, y) => {
    const { pending } = get();
    const sessionId = useDocumentStore.getState().activeId;
    if (pending === null || sessionId === null) return;

    set({ pending: null });
    await exclusive(() =>
      addStaged(sessionId, page, pending, { x, y: y - pending.height }, 'Add image'),
    );
  },

  ...createImageTools(set, get, { exclusive, run, reselect, addStaged, imageOf, report }),
}));

/**
 * Runs one change with the editor to itself. A change asked for while another
 * is being made is dropped, not queued: the second would be made against an
 * image the first has already moved, replaced or removed.
 */
async function exclusive(change: () => Promise<void>): Promise<void> {
  if (useImageEditStore.getState().busy) return;
  useImageEditStore.setState({ busy: true });
  try {
    await change();
  } finally {
    useImageEditStore.setState({ busy: false });
  }
}

/**
 * Draws a staged picture on a page with its bottom-left corner at a point,
 * under a name chosen here so it can be selected the moment it is written.
 */
async function addStaged(
  sessionId: string,
  page: number,
  staged: StampImage,
  corner: { x: number; y: number },
  label: string,
): Promise<void> {
  const imageId = `pf-${globalThis.crypto.randomUUID()}`;
  const placement = {
    ...corner,
    width: staged.width,
    height: staged.height,
    rotation: 0,
    flipX: false,
    flipY: false,
  };
  await run(sessionId, {
    label,
    operations: [{ kind: 'addImage', page, token: staged.token, placement, opacity: 1, imageId }],
  });
  await reselect(sessionId, page, placement, imageId);
}

/**
 * Applies a change, and shows a moved image where it now goes until the page
 * is drawn with it. Callers hold the editor with {@link exclusive}.
 */
async function run(
  sessionId: string,
  transaction: Parameters<ReturnType<typeof useDocumentStore.getState>['applyEdit']>[1],
  moved: Omit<MovedImage, 'sessionId' | 'madeIn'> | null = null,
): Promise<void> {
  // Asked only when there is something to ask, so a plain change is applied
  // without waiting a turn.
  const uses = sharedUses(sessionId, transaction.operations);
  if (uses > 1) {
    const scope = await askScope(uses);
    if (scope === null) return;
    transaction = {
      ...transaction,
      operations: transaction.operations.map((operation) =>
        operation.kind === 'placeImage' || operation.kind === 'deleteImage'
          ? { ...operation, scope }
          : operation,
      ),
    };
  }

  const before = revisionOf(sessionId);
  useImageEditStore.setState({
    moved: moved === null ? null : { ...moved, sessionId, madeIn: null },
  });
  try {
    await useDocumentStore.getState().applyEdit(sessionId, transaction);
  } finally {
    const after = revisionOf(sessionId);
    useImageEditStore.setState((state) => ({
      moved:
        state.moved === null || state.moved.madeIn !== null
          ? state.moved
          : // Nothing was written, so there is nothing to wait for.
            after === undefined || after === before
            ? null
            : { ...state.moved, madeIn: after },
    }));
  }
}

/** The most times any picture a change touches is drawn, through a shared form. */
function sharedUses(sessionId: string, operations: readonly EditOperation[]): number {
  let uses = 1;
  for (const operation of operations) {
    if (operation.kind !== 'placeImage' && operation.kind !== 'deleteImage') continue;
    const image = imageOf(
      useImageEditStore.getState(),
      sessionId,
      operation.page,
      operation.imageId,
    );
    uses = Math.max(uses, image?.formUses ?? 1);
  }
  return uses;
}

/**
 * For a picture inside a form the document draws more than once, asks whether
 * the change is for this drawing or for all of them; null when the reader
 * dismissed the question.
 */
function askScope(uses: number): Promise<ImageScope | null> {
  return new Promise((resolve) => {
    useUiStore.getState().requestConfirmation({
      title: 'Change every copy?',
      message: `This picture is part of a drawing the document uses ${String(
        uses,
      )} times. Change only the one you picked, or all ${String(uses)}?`,
      confirmLabel: 'Only this one',
      alternative: { label: `All ${String(uses)}`, onChoose: () => resolve('all') },
      onConfirm: () => resolve('this'),
      onCancel: () => resolve(null),
    });
  });
}

/** The revision a document is at, as its tab knows it. */
function revisionOf(sessionId: string): number | undefined {
  return useDocumentStore.getState().tabs.find((tab) => tab.session.id === sessionId)?.edit
    .revision;
}

/**
 * Finds the image again after a change, and keeps it selected.
 *
 * An image is named by where it sits in the page's content, and every change
 * rewrites that content, so the name it had is gone. What has not changed is
 * where the image is: the one now in the box that was just written is the one
 * the reader is still working on.
 */
async function reselect(
  sessionId: string,
  page: number,
  placement: ImagePlacementInput,
  id?: string,
): Promise<void> {
  const revision = useDocumentStore.getState().tabs.find((tab) => tab.session.id === sessionId)
    ?.edit.revision;
  if (revision === undefined) return;

  await useImageEditStore.getState().load(sessionId, page, revision);
  const images = imagesFor(useImageEditStore.getState().pages, sessionId, page);

  // An image PaperForge added keeps its name, so there is nothing to guess.
  if (id?.startsWith('pf-') === true) {
    if (images.some((image) => image.id === id)) {
      useImageEditStore.setState({ selected: { page, id } });
    }
    return;
  }

  const wanted = centreOf(placement);
  let nearest: { id: string; distance: number } | null = null;
  for (const image of images) {
    const centre = centreOf(image.placement);
    const distance = Math.hypot(centre.x - wanted.x, centre.y - wanted.y);
    if (nearest === null || distance < nearest.distance) nearest = { id: image.id, distance };
  }

  // Only the image that is actually there: a change that removed it, or moved
  // it somewhere else, leaves nothing selected rather than the wrong thing.
  if (nearest !== null && nearest.distance < 1) {
    useImageEditStore.setState({ selected: { page, id: nearest.id } });
  }
}

function centreOf(placement: ImagePlacementInput): { x: number; y: number } {
  return { x: placement.x + placement.width / 2, y: placement.y + placement.height / 2 };
}

function imageOf(
  store: ImageEditStore,
  sessionId: string,
  page: number,
  id: string,
): PageImageModel | undefined {
  return store.pages
    .get(keyOf(sessionId, page))
    ?.model.images.find((candidate) => candidate.id === id);
}

/** The images of a page, or none while it is still being read. */
export function imagesFor(
  pages: ReadonlyMap<string, LoadedImagePage>,
  sessionId: string,
  page: number,
): readonly PageImageModel[] {
  return pages.get(keyOf(sessionId, page))?.model.images ?? NO_IMAGES;
}

/** What is known about the images of a page, for saying so. */
export type ImagePageStatus =
  | { state: 'loading' }
  | { state: 'failed'; message: string }
  | { state: 'read'; count: number; skipped: readonly SkippedImageReason[] };

export function imagePageStatus(
  pages: ReadonlyMap<string, LoadedImagePage>,
  failed: ReadonlyMap<string, string>,
  sessionId: string,
  page: number,
): ImagePageStatus {
  const key = keyOf(sessionId, page);
  const loaded = pages.get(key);
  if (loaded !== undefined) {
    return { state: 'read', count: loaded.model.images.length, skipped: loaded.model.skipped };
  }
  const message = failed.get(key);
  return message === undefined ? { state: 'loading' } : { state: 'failed', message };
}

/** One frozen empty list, so a page with no images does not re-render forever. */
const NO_IMAGES: readonly PageImageModel[] = Object.freeze([]);
