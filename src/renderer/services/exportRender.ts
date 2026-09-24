import type { LoadedPdfDocument } from '@pdf/render/types';
import type { ExportOptions } from '@shared/schemas/convert';
import { AppError } from '@shared/errors/appError';

/** A page bigger than this would cost more memory than any export is worth. */
const MAX_PIXELS = 60_000_000;

/**
 * Drawing a page as a picture for an export.
 *
 * The picture is what the reader sees, at the resolution they chose. A format
 * without transparency gets paper under it first, so a page that draws no
 * background of its own does not come out black.
 */
export async function renderPageForExport(
  document: LoadedPdfDocument,
  pageNumber: number,
  options: ExportOptions,
): Promise<string> {
  const scale = options.dpi / 72;
  const size = document.pageSize(pageNumber, scale, 0);
  if (size.width * size.height > MAX_PIXELS) {
    throw new AppError('convert/failed', {
      message: 'That page is too large to draw at this resolution.',
      details: 'Choose a lower resolution and try again.',
    });
  }

  const canvas = window.document.createElement('canvas');
  await document.renderPage({
    pageNumber,
    scale,
    rotation: 0,
    canvas,
    devicePixelRatio: 1,
  });

  const wantsPaper = options.mode === 'jpeg' || options.mode === 'html' || !options.transparent;
  if (wantsPaper) paperBehind(canvas);

  // An export that puts pictures inside a document always writes PNG: it is
  // lossless, and the reader's quality setting is about the pictures they
  // asked for, not the ones inside a slide.
  const asPng = options.mode !== 'jpeg' && options.mode !== 'webp';
  const type = asPng ? 'image/png' : `image/${options.mode}`;
  const dataUrl = canvas.toDataURL(type, options.quality / 100);

  canvas.width = 0;
  canvas.height = 0;

  const comma = dataUrl.indexOf(',');
  return comma < 0 ? dataUrl : dataUrl.slice(comma + 1);
}

/** Paints white under what was drawn, without disturbing it. */
function paperBehind(canvas: HTMLCanvasElement): void {
  const context = canvas.getContext('2d');
  if (context === null) return;

  context.globalCompositeOperation = 'destination-over';
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.globalCompositeOperation = 'source-over';
}
