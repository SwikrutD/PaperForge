import type { LoadedPdfDocument } from '@pdf/render/types';
import type { PixelRegion } from '@pdf/compare/pixelDiff';
import type { CompareWorkerRequest, CompareWorkerResponse } from '@pdf/compare/workerProtocol';
import { AppError } from '@shared/errors/appError';

/**
 * Drawing pages for comparison, and handing their pixels to the worker.
 *
 * Both pages of a pair are drawn at the same scale, anchored at the top-left
 * corner, on paper of the larger of the two sizes, so the same pixel means
 * the same place on both.
 */

/** The longer side of a compared page, in pixels: detailed enough, and bounded. */
const COMPARE_PIXELS = 1400;

export interface ComparedPixels {
  width: number;
  height: number;
  original: Uint8ClampedArray;
  revised: Uint8ClampedArray;
  /** CSS pixels per PDF unit the pages were drawn at. */
  scale: number;
}

/** One scale for both pages, chosen so the larger fits `COMPARE_PIXELS`. */
export function compareScale(
  original: { width: number; height: number },
  revised: { width: number; height: number },
): number {
  const longest = Math.max(original.width, original.height, revised.width, revised.height, 1);
  return Math.min(2, COMPARE_PIXELS / longest);
}

export async function drawPair(
  original: LoadedPdfDocument,
  originalPage: number,
  revised: LoadedPdfDocument,
  revisedPage: number,
): Promise<ComparedPixels> {
  const scale = compareScale(
    original.pageSize(originalPage, 1, 0),
    revised.pageSize(revisedPage, 1, 0),
  );
  const first = await drawPage(original, originalPage, scale);
  const second = await drawPage(revised, revisedPage, scale);
  const width = Math.max(first.width, second.width);
  const height = Math.max(first.height, second.height);
  return {
    width,
    height,
    scale,
    original: onPaper(first, width, height),
    revised: onPaper(second, width, height),
  };
}

async function drawPage(
  document: LoadedPdfDocument,
  pageNumber: number,
  scale: number,
): Promise<ImageData> {
  const canvas = window.document.createElement('canvas');
  await document.renderPage({ pageNumber, scale, rotation: 0, canvas, devicePixelRatio: 1 });
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (context === null) {
    throw new AppError('internal/unexpected', { message: 'A page could not be drawn to compare.' });
  }
  // Paper under the page, so a page that draws no background is white.
  context.globalCompositeOperation = 'destination-over';
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  canvas.width = 0;
  canvas.height = 0;
  return image;
}

/** The page's pixels on white paper of the given size, top-left aligned. */
function onPaper(image: ImageData, width: number, height: number): Uint8ClampedArray {
  if (image.width === width && image.height === height) return image.data;
  const out = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let row = 0; row < image.height; row += 1) {
    out.set(
      image.data.subarray(row * image.width * 4, (row + 1) * image.width * 4),
      row * width * 4,
    );
  }
  return out;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, (response: CompareWorkerResponse) => void>();

function compareWorker(): Worker {
  if (worker !== null) return worker;
  worker = new Worker(new URL('../../workers/compare.worker.ts', import.meta.url), {
    type: 'module',
    name: 'PaperForge comparison',
  });
  worker.onmessage = (event: MessageEvent<CompareWorkerResponse>) => {
    const resolve = pending.get(event.data.id);
    pending.delete(event.data.id);
    resolve?.(event.data);
  };
  return worker;
}

export interface WorkerDiff {
  regions: PixelRegion[];
  changedRatio: number;
  overlay: Uint8ClampedArray | null;
}

/** Compares two pages' pixels in the worker. The buffers are handed over, not copied. */
export function diffInWorker(pixels: ComparedPixels, overlay: boolean): Promise<WorkerDiff> {
  const id = nextId;
  nextId += 1;
  const request: CompareWorkerRequest = {
    id,
    width: pixels.width,
    height: pixels.height,
    original: pixels.original.buffer as ArrayBuffer,
    revised: pixels.revised.buffer as ArrayBuffer,
    overlay,
  };

  return new Promise<WorkerDiff>((resolve, reject) => {
    pending.set(id, (response) => {
      if (!response.ok) {
        reject(
          new AppError('internal/unexpected', {
            message: 'Two pages could not be compared.',
            details: response.message,
          }),
        );
        return;
      }
      resolve({
        regions: response.regions,
        changedRatio: response.changedRatio,
        overlay: response.overlay === null ? null : new Uint8ClampedArray(response.overlay),
      });
    });
    compareWorker().postMessage(request, [request.original, request.revised]);
  });
}
