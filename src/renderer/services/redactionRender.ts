import type { LoadedPdfDocument } from '@pdf/render/types';
import type { RedactionRect } from '@shared/schemas/redaction';
import { AppError } from '@shared/errors/appError';
import { pdfRectToCss } from '../components/viewer/pageGeometry';

/** 200 dots an inch keeps small print legible without a page costing too much. */
const DPI = 200;
/** A page bigger than this is drawn at less than 200 dots an inch. */
const MAX_PIXELS = 40_000_000;

export interface RenderedRedactionPage {
  /** JPEG bytes, base64-encoded, for the one way pictures cross IPC. */
  image: string;
  /** The part of the page the picture covers, in user space. */
  viewBox: [number, number, number, number];
}

/**
 * Draws a page as a picture with its marked areas already painted over.
 *
 * This is what stands in for a page whose content PaperForge cannot cut
 * safely. The page is drawn upright, without its annotations and with its
 * layers as the document sets them; the marks are then painted onto the
 * pixels themselves, a pixel wider on every side so no anti-aliased edge of
 * what was underneath survives. What leaves this function has never held the
 * marked content in any form but paint.
 */
export async function renderPageForRedaction(
  document: LoadedPdfDocument,
  pageNumber: number,
  rects: readonly RedactionRect[],
  fill: { r: number; g: number; b: number },
): Promise<RenderedRedactionPage> {
  const geometry = document.pages[pageNumber - 1];
  if (geometry === undefined) {
    throw new AppError('redact/failed', {
      message: 'That page is not in this document any more.',
      details: `page ${String(pageNumber)}`,
    });
  }

  // Upright: the page's own rotation is turned back, so the picture lines up
  // with the user space it is placed in. The page keeps its /Rotate.
  const rotation = -geometry.rotation;
  const natural = document.pageSize(pageNumber, 1, rotation);
  const scale = Math.min(
    DPI / 72,
    Math.sqrt(MAX_PIXELS / Math.max(1, natural.width * natural.height)),
  );

  const canvas = window.document.createElement('canvas');
  await document.renderPage({
    pageNumber,
    scale,
    rotation,
    canvas,
    devicePixelRatio: 1,
    contentOnly: true,
  });

  const context = canvas.getContext('2d');
  if (context === null) {
    throw new AppError('redact/failed', { message: 'The page could not be drawn as a picture.' });
  }

  // Paper under anything the page left transparent, as JPEG has no alpha.
  context.globalCompositeOperation = 'destination-over';
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.globalCompositeOperation = 'source-over';

  context.fillStyle = `rgb(${channel(fill.r)}, ${channel(fill.g)}, ${channel(fill.b)})`;
  for (const rect of rects) {
    const box = pdfRectToCss(rect, geometry, scale, rotation);
    if (box === null) continue;
    context.fillRect(
      Math.floor(box.left) - 1,
      Math.floor(box.top) - 1,
      Math.ceil(box.width) + 3,
      Math.ceil(box.height) + 3,
    );
  }

  const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
  canvas.width = 0;
  canvas.height = 0;

  const [x1, y1, x2, y2] = geometry.viewBox;
  const comma = dataUrl.indexOf(',');
  return {
    image: comma < 0 ? dataUrl : dataUrl.slice(comma + 1),
    viewBox: [x1, y1, x2, y2],
  };
}

function channel(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 255);
}
