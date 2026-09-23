import type { PDFFont } from 'pdf-lib';

/**
 * Text for appearance streams.
 *
 * The comment itself is stored as written, in full Unicode. What an appearance
 * *draws* is limited by the font it draws with: Helvetica is a Latin-1 font,
 * so anything outside that is shown as a question mark rather than crashing
 * the save or silently dropping the line.
 */

const REPLACEMENT = '?';

/** Keeps what Helvetica can draw and replaces the rest. */
export function toWinAnsi(value: string): string {
  let result = '';
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code === 9) {
      result += '    ';
    } else if (code >= 32 && code <= 126) {
      result += character;
    } else if (code >= 160 && code <= 255) {
      result += character;
    } else if (code === 8217 || code === 8216) {
      result += "'";
    } else if (code === 8220 || code === 8221) {
      result += '"';
    } else if (code === 8211 || code === 8212) {
      result += '-';
    } else if (code === 8230) {
      result += '...';
    } else {
      result += REPLACEMENT;
    }
  }
  return result;
}

/** True when every character can be drawn as written. */
export function isDrawable(value: string): boolean {
  return toWinAnsi(value) === value;
}

/**
 * Breaks text into lines that fit a box, keeping the author's own line breaks
 * and splitting a word that is too long for a line on its own.
 */
export function wrapText(
  value: string,
  font: PDFFont,
  fontSize: number,
  boxWidth: number,
): string[] {
  const usable = Math.max(1, boxWidth - fontSize * 0.7);
  const lines: string[] = [];

  for (const paragraph of toWinAnsi(value).split(/\r\n|\r|\n/)) {
    if (paragraph === '') {
      lines.push('');
      continue;
    }

    let current = '';
    for (const word of paragraph.split(/(\s+)/)) {
      if (word === '') continue;
      const candidate = current + word;
      if (current !== '' && widthOf(font, candidate, fontSize) > usable) {
        lines.push(current.trimEnd());
        current = word.trimStart();
        // A single word wider than the box has to be broken somewhere.
        while (widthOf(font, current, fontSize) > usable && current.length > 1) {
          let cut = current.length - 1;
          while (cut > 1 && widthOf(font, current.slice(0, cut), fontSize) > usable) cut -= 1;
          lines.push(current.slice(0, cut));
          current = current.slice(cut);
        }
      } else {
        current = candidate;
      }
    }
    lines.push(current.trimEnd());
  }

  return lines;
}

/** Font metrics, with a fallback for a font that refuses a character. */
function widthOf(font: PDFFont, text: string, size: number): number {
  try {
    return font.widthOfTextAtSize(text, size);
  } catch {
    // Standard fonts throw on characters they cannot encode; an estimate is
    // better than failing a save over a text box's line breaks.
    return text.length * size * 0.5;
  }
}
