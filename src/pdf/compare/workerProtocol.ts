import type { PixelRegion } from './pixelDiff';

/** What the window sends the comparison worker: two pages' pixels. */
export interface CompareWorkerRequest {
  id: number;
  width: number;
  height: number;
  /** RGBA bytes, transferred. */
  original: ArrayBuffer;
  revised: ArrayBuffer;
  /** Also return a picture of the difference. */
  overlay: boolean;
}

export type CompareWorkerResponse =
  | {
      id: number;
      ok: true;
      regions: PixelRegion[];
      changedRatio: number;
      /** RGBA bytes of the difference picture, transferred. */
      overlay: ArrayBuffer | null;
    }
  | { id: number; ok: false; message: string };
