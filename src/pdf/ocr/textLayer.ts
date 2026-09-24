import type { OcrWord } from '@shared/schemas/ocr';
import { furnitureBlock } from '@pdf/content/furniture';
import { formatNumber } from '@pdf/content/values';
import { toWinAnsi } from '@pdf/text/layout';

/**
 * The invisible layer of words that makes a scan searchable.
 *
 * The picture the page arrived with is left exactly as it is. Over it goes
 * text drawn in rendering mode 3 — which paints nothing at all — placed and
 * stretched so that each word sits over the marks it was read from. Selecting
 * the words, searching them and copying them then all work, and the page
 * still looks like the scan it is.
 */

export interface TextLayerOptions {
  /** The words Tesseract read, in the pixels of the picture it read. */
  words: readonly OcrWord[];
  /** The size of that picture, in pixels. */
  imageWidth: number;
  imageHeight: number;
  /** The size of the page the words are going onto, in PDF units. */
  pageWidth: number;
  pageHeight: number;
  /** The font resource to draw with, which the caller has put on the page. */
  fontResource: string;
  /** Widths of the font's characters, per 1000 units, for stretching a word. */
  widthOf: (text: string, size: number) => number;
  /** Words Tesseract was less sure of than this are left out. */
  minimumConfidence?: number;
}

/**
 * Builds the content for the layer, marked as PaperForge's own so that
 * recognising a page again replaces the words rather than stacking a second
 * set on top of them.
 */
export function buildTextLayer(options: TextLayerOptions): string | null {
  const scaleX = options.pageWidth / options.imageWidth;
  const scaleY = options.pageHeight / options.imageHeight;
  const minimum = options.minimumConfidence ?? 0;

  const parts: string[] = ['BT', '3 Tr'];
  let drawn = 0;

  for (const word of options.words) {
    if (word.confidence >= 0 && word.confidence < minimum) continue;
    if (word.width <= 0 || word.height <= 0) continue;

    const text = toWinAnsi(word.text)
      .replace(/[\r\n]/g, ' ')
      .trim();
    if (text === '') continue;

    // The word's box, in PDF units, measured from the bottom of the page.
    const left = word.left * scaleX;
    const bottom = options.pageHeight - (word.top + word.height) * scaleY;
    const width = word.width * scaleX;
    const height = word.height * scaleY;

    // A cap-height of about 0.72 em puts the baseline where the scan has it.
    const size = Math.max(1, height / 0.86);
    const natural = options.widthOf(text, size);
    if (natural <= 0) continue;

    // `Tz` stretches the word to the width it occupies in the picture, so a
    // selection follows the marks rather than the font's own spacing.
    const stretch = clamp((width / natural) * 100, 1, 1000);

    parts.push(`${formatNumber(round(stretch))} Tz`);
    parts.push(`/${options.fontResource} ${formatNumber(round(size))} Tf`);
    parts.push(
      `1 0 0 1 ${formatNumber(round(left))} ${formatNumber(round(bottom + height * 0.18))} Tm`,
    );
    parts.push(`${pdfString(text)} Tj`);
    drawn += 1;
  }

  if (drawn === 0) return null;
  parts.push('ET');
  return furnitureBlock('ocr', parts.join('\n'));
}

function pdfString(value: string): string {
  return `(${value.replace(/([\\()])/g, '\\$1')})`;
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
