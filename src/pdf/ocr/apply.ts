import type { PDFDocument } from 'pdf-lib';
import { AppError } from '@shared/errors/appError';
import type { EditOperation } from '@shared/schemas/edit';
import { DEFAULT_TEXT_STYLE } from '@shared/schemas/text';
import { appendFurniture, removeFurniture } from '@pdf/content/furniture';
import { contentBytes } from '@pdf/content/pageContent';
import { setPageContent } from '@pdf/mutate/text';
import { ensureFontResource, standardFont } from '@pdf/mutate/textResources';
import { buildTextLayer } from './textLayer';

/**
 * Putting recognised words onto a page.
 *
 * The page keeps everything it had: the words are appended as an invisible
 * layer, marked as PaperForge's own, so recognising a page a second time
 * replaces the words rather than leaving two sets of them on top of each
 * other.
 */
export async function applyOcrOperation(
  document: PDFDocument,
  operation: EditOperation,
): Promise<boolean> {
  if (operation.kind !== 'addRecognisedText') return false;

  for (const result of operation.pages) {
    const pageIndex = result.page - 1;
    if (pageIndex < 0 || pageIndex >= document.getPageCount()) {
      throw new AppError('internal/unexpected', {
        message: 'That page is not in this document any more.',
        details: `page ${String(result.page)} of ${String(document.getPageCount())}`,
      });
    }

    const page = document.getPage(pageIndex);
    const size = page.getSize();
    const resource = await ensureFontResource(document, page, DEFAULT_TEXT_STYLE);
    const font = await standardFont(document, DEFAULT_TEXT_STYLE);

    const layer = buildTextLayer({
      words: result.words,
      imageWidth: result.imageWidth,
      imageHeight: result.imageHeight,
      pageWidth: size.width,
      pageHeight: size.height,
      fontResource: resource,
      widthOf: (text, fontSize) => widthOf(font, text, fontSize),
    });

    // Whatever was recognised before goes, whether or not there is anything
    // to put in its place: a page read again should not keep old words.
    const stripped = removeFurniture(contentBytes(document, page), ['ocr']);
    const bytes = layer === null ? stripped.bytes : appendFurniture(stripped.bytes, layer);
    if (layer === null && stripped.removed === 0) continue;

    setPageContent(document, pageIndex, bytes);
  }

  return true;
}

/** Font metrics, with an estimate for a character the font refuses. */
function widthOf(
  font: { widthOfTextAtSize: (text: string, size: number) => number },
  text: string,
  size: number,
): number {
  try {
    return font.widthOfTextAtSize(text, size);
  } catch {
    return text.length * size * 0.5;
  }
}
