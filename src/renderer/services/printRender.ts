import type { LoadedPdfDocument } from '@pdf/render/types';
import { AppError } from '@shared/errors/appError';

/** Past this a page would cost more memory than a printer can use. */
const MAX_PIXELS = 80_000_000;

export interface PrintPagePicture {
  /** PNG, base64-encoded. */
  image: string;
  /** The page's size in points as it is seen. */
  width: number;
  height: number;
}

/**
 * Drawing a page for the printer: on white paper, with the page's own
 * rotation and nothing the reader has turned only for viewing, at the
 * resolution the job asks for.
 */
export async function renderPageForPrint(
  document: LoadedPdfDocument,
  pageNumber: number,
  options: { dpi: number; annotations: boolean },
): Promise<PrintPagePicture> {
  const geometry = document.pages[pageNumber - 1];
  if (geometry === undefined) {
    throw new AppError('print/failed', { details: `There is no page ${String(pageNumber)}.` });
  }

  // A very large page is drawn more coarsely rather than not at all.
  const wanted = options.dpi / 72;
  const area = geometry.width * geometry.height;
  const scale = Math.min(wanted, Math.sqrt(MAX_PIXELS / Math.max(1, area)));

  const canvas = window.document.createElement('canvas');
  await document.renderPage({
    pageNumber,
    scale,
    rotation: 0,
    canvas,
    devicePixelRatio: 1,
    print: { annotations: options.annotations },
  });

  const context = canvas.getContext('2d');
  if (context !== null) {
    context.globalCompositeOperation = 'destination-over';
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.globalCompositeOperation = 'source-over';
  }

  const dataUrl = canvas.toDataURL('image/png');
  canvas.width = 0;
  canvas.height = 0;

  const comma = dataUrl.indexOf(',');
  return {
    image: comma < 0 ? dataUrl : dataUrl.slice(comma + 1),
    width: geometry.width,
    height: geometry.height,
  };
}
