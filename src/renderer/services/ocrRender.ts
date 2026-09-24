import type { LoadedPdfDocument } from '@pdf/render/types';
import type { OcrOptions } from '@shared/schemas/ocr';
import { AppError } from '@shared/errors/appError';

/** A page bigger than this would cost more memory than it is worth. */
const MAX_PIXELS = 40_000_000;

/**
 * Renders one page as a picture for Tesseract to read.
 *
 * The page is drawn at the resolution the reader chose — 300 dots an inch is
 * what a scanner produces and what Tesseract expects — onto a canvas that is
 * thrown away as soon as the bytes are out of it. Nothing about the document
 * changes: this is a photograph of the page, not an edit to it.
 */
export async function renderPageForOcr(
  document: LoadedPdfDocument,
  pageNumber: number,
  options: OcrOptions,
): Promise<string> {
  const scale = options.dpi / 72;
  const size = document.pageSize(pageNumber, scale, 0);
  if (size.width * size.height > MAX_PIXELS) {
    throw new AppError('ocr/failed', {
      message: 'That page is too large to read at this resolution.',
      details: 'Choose a lower resolution and try again.',
    });
  }

  const canvas = window.document.createElement('canvas');
  await document.renderPage({
    pageNumber,
    scale,
    rotation: 0,
    canvas,
    // The page is already being drawn at the chosen resolution; the screen's
    // own scaling would only make it bigger for no gain.
    devicePixelRatio: 1,
  });

  if (options.preprocess) grey(canvas);

  const dataUrl = canvas.toDataURL('image/png');
  // The canvas is dropped here; a page of a long document should not stay in
  // memory once its picture has been handed over.
  canvas.width = 0;
  canvas.height = 0;

  const comma = dataUrl.indexOf(',');
  return comma < 0 ? dataUrl : dataUrl.slice(comma + 1);
}

/**
 * Greys the picture and lifts its contrast.
 *
 * A photographed page is uneven and slightly coloured; flattening it to grey
 * and pushing the light and dark apart helps Tesseract without touching the
 * document itself. A clean scan is left much as it was.
 */
function grey(canvas: HTMLCanvasElement): void {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (context === null) return;

  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = image;

  for (let index = 0; index < data.length; index += 4) {
    const value =
      0.299 * (data[index] ?? 0) + 0.587 * (data[index + 1] ?? 0) + 0.114 * (data[index + 2] ?? 0);
    // A gentle S-curve about the middle: darker ink, cleaner paper, and
    // nothing clipped so hard that thin strokes disappear.
    const lifted = value < 128 ? value * 0.8 : 255 - (255 - value) * 0.8;
    const clamped = Math.max(0, Math.min(255, Math.round(lifted)));
    data[index] = clamped;
    data[index + 1] = clamped;
    data[index + 2] = clamped;
  }

  context.putImageData(image, 0, 0);
}
