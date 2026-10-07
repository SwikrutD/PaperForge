import type { StampImage } from '@shared/schemas/annotation';
import type { EditTransaction, ImagePlacementInput } from '@shared/schemas/edit';
import type { PageImageModel } from '@shared/schemas/image';
import { invoke } from '../services/ipcClient';
import { placementOfCrop, type ImageCrop } from '../components/edit/imageGeometry';
import { useDocumentStore } from './documentStore';
import { useUiStore } from './uiStore';
import type { ImageEditStore, MovedImage } from './imageEditStore';

/**
 * The image editor's keyboard and on-page tools: pasting a picture, nudging
 * one with the arrow keys, and cropping one by dragging its edges.
 *
 * Each ends in exactly one change to the document, so each is one undo.
 */

/** A crop being dragged on the page, in the image's own square. */
export interface ImageCropping {
  page: number;
  id: string;
  crop: ImageCrop;
}

export interface ImageTools {
  /**
   * Draws the picture on the clipboard on a page, centred on a point, and
   * selects it. Says so when the clipboard holds no picture.
   */
  paste: (page: number, centre: { x: number; y: number }) => Promise<void>;
  /** Moves the selected image by a step, shown at once and written later. */
  nudge: (dx: number, dy: number) => void;
  /** Writes the nudges made so far as one change. */
  commitNudge: () => Promise<void>;
  /** Starts cropping the selected image on the page. */
  beginCrop: () => void;
  setCropDraft: (crop: ImageCrop) => void;
  cancelCrop: () => void;
  /**
   * Writes the crop being dragged. A plain crop clips the picture and keeps
   * every pixel; `cut` throws away what does not show.
   */
  applyCrop: (options?: { cut?: boolean }) => Promise<void>;
}

/** What the tools borrow from the store that owns them. */
export interface ImageToolHelpers {
  exclusive: (change: () => Promise<void>) => Promise<void>;
  run: (
    sessionId: string,
    transaction: EditTransaction,
    moved?: Omit<MovedImage, 'sessionId' | 'madeIn'> | null,
  ) => Promise<void>;
  reselect: (
    sessionId: string,
    page: number,
    placement: ImagePlacementInput,
    id?: string,
  ) => Promise<void>;
  addStaged: (
    sessionId: string,
    page: number,
    staged: StampImage,
    corner: { x: number; y: number },
    label: string,
  ) => Promise<void>;
  imageOf: (
    store: ImageEditStore,
    sessionId: string,
    page: number,
    id: string,
  ) => PageImageModel | undefined;
  report: (error: unknown) => void;
}

type Set = (partial: Partial<ImageEditStore>) => void;
type Get = () => ImageEditStore;

const WHOLE: ImageCrop = { x: 0, y: 0, width: 1, height: 1 };

export function createImageTools(set: Set, get: Get, helpers: ImageToolHelpers): ImageTools {
  const { exclusive, run, reselect, addStaged, imageOf, report } = helpers;

  /** The selected image of the active document, with what is needed to change it. */
  const target = (): { sessionId: string; page: number; image: PageImageModel } | null => {
    const sessionId = useDocumentStore.getState().activeId;
    const selected = get().selected;
    if (sessionId === null || selected === null) return null;
    const image = imageOf(get(), sessionId, selected.page, selected.id);
    return image === undefined ? null : { sessionId, page: selected.page, image };
  };

  return {
    paste: async (page, centre) => {
      const sessionId = useDocumentStore.getState().activeId;
      if (sessionId === null) return;

      await exclusive(async () => {
        let staged: StampImage | null;
        try {
          staged = await invoke('images:paste', { sessionId });
        } catch (error) {
          report(error);
          return;
        }
        if (staged === null) {
          useUiStore.getState().showToast({
            title: 'There is no picture on the clipboard to paste.',
            description: 'Copy an image first, then paste it with Ctrl+V.',
            intent: 'info',
          });
          return;
        }

        set({ pending: null, cropping: null });
        const corner = { x: centre.x - staged.width / 2, y: centre.y - staged.height / 2 };
        await addStaged(sessionId, page, staged, corner, 'Paste image');
      });
    },

    nudge: (dx, dy) => {
      const found = target();
      if (found === null || get().busy || get().cropping !== null) return;
      const { drag } = get();
      const from =
        drag?.page === found.page && drag.id === found.image.id
          ? drag.placement
          : found.image.placement;
      set({
        drag: {
          page: found.page,
          id: found.image.id,
          placement: { ...from, x: from.x + dx, y: from.y + dy },
        },
      });
    },

    commitNudge: async () => {
      const found = target();
      const { drag } = get();
      if (found === null || drag?.id !== found.image.id || drag.page !== found.page) return;
      await get().place(found.page, found.image.id, drag.placement);
    },

    beginCrop: () => {
      const found = target();
      if (found === null || get().busy) return;
      set({
        drag: null,
        cropping: { page: found.page, id: found.image.id, crop: found.image.crop ?? WHOLE },
      });
    },

    setCropDraft: (crop) => {
      const { cropping } = get();
      if (cropping !== null) set({ cropping: { ...cropping, crop } });
    },

    cancelCrop: () => set({ cropping: null }),

    applyCrop: async (options = {}) => {
      const sessionId = useDocumentStore.getState().activeId;
      const { cropping } = get();
      if (sessionId === null || cropping === null) return;
      const image = imageOf(get(), sessionId, cropping.page, cropping.id);
      if (image === undefined) return;
      set({ cropping: null });

      const whole = isWhole(cropping.crop);
      if (options.cut !== true) {
        await get().crop(cropping.page, cropping.id, whole ? null : cropping.crop);
        return;
      }
      if (whole) return;

      await exclusive(async () => {
        let cut: { image: StampImage; crop: ImageCrop };
        try {
          cut = await invoke('images:cut', {
            sessionId,
            page: cropping.page,
            imageId: cropping.id,
            crop: cropping.crop,
          });
        } catch (error) {
          report(error);
          return;
        }

        const placement = placementOfCrop(image.placement, cut.crop);
        await run(sessionId, {
          label: 'Cut image to crop',
          operations: [
            {
              kind: 'placeImage',
              page: cropping.page,
              imageId: cropping.id,
              placement,
              crop: null,
              opacity: image.opacity,
              token: cut.image.token,
            },
          ],
        });
        await reselect(sessionId, cropping.page, placement, cropping.id);
      });
    },
  };
}

function isWhole(crop: ImageCrop): boolean {
  return crop.x <= 0.0005 && crop.y <= 0.0005 && crop.width >= 0.999 && crop.height >= 0.999;
}
