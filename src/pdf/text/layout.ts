import type { PDFFont } from 'pdf-lib';
import { codeForUnicode } from '../content/encodings';

/**
 * Laying text out with a standard PDF font: what can be drawn, and where the
 * lines end.
 *
 * Shared by the comments that draw their own appearance and by the pages made
 * from a text file. Text is stored as written, in full Unicode; what is
 * *drawn* is limited by the font drawing it — Helvetica is a Latin-1 font, so
 * anything outside that is shown as a question mark rather than crashing the
 * write or silently dropping the line.
 */

const REPLACEMENT = '?';

/**
 * Keeps what Helvetica can draw and replaces the rest.
 *
 * Line breaks are kept: this maps characters, and it is `wrapText` that
 * decides where lines end. Anything that must be a single line says so.
 */
export function toWinAnsi(value: string): string {
  let result = '';
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code === 9) {
      result += '    ';
    } else if (code === 10 || code === 13) {
      result += character;
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

/** Text in the bytes a standard font is written with, and what it could not hold. */
export interface WinAnsiText {
  /** WinAnsi codes; an undrawable character is a question mark. */
  bytes: Uint8Array;
  /** Each character that could not be encoded, once, in the order met. */
  undrawable: string[];
}

/**
 * Encodes text for one of the standard fonts as pdf-lib embeds them, which is
 * WinAnsi (code page 1252): Latin-1 plus the curly quotes, dashes, ellipsis,
 * euro sign, bullets and the rest of 0x80–0x9F.
 *
 * A tab is four spaces, as everywhere else PaperForge lays text out; any other
 * control character, and anything outside WinAnsi, is undrawable.
 */
export function encodeWinAnsi(value: string): WinAnsiText {
  const codes: number[] = [];
  const undrawable: string[] = [];

  for (const character of value) {
    if (character === '\t') {
      codes.push(0x20, 0x20, 0x20, 0x20);
      continue;
    }
    const point = character.codePointAt(0) ?? 0;
    const control = point < 0x20 || point === 0x7f;
    const code = control ? null : codeForUnicode('WinAnsiEncoding', character);
    if (code === null) {
      if (!undrawable.includes(character)) undrawable.push(character);
      codes.push(REPLACEMENT.charCodeAt(0));
    } else {
      codes.push(code);
    }
  }

  return { bytes: Uint8Array.from(codes), undrawable };
}

/**
 * True when every character can be drawn as itself by the text editor's
 * standard fonts — WinAnsi punctuation included.
 */
export function isDrawable(value: string): boolean {
  return encodeWinAnsi(value).undrawable.length === 0;
}

/** One line of drawable text, for a label that cannot wrap. */
export function toSingleLine(value: string): string {
  return toWinAnsi(value)
    .replace(/[\r\n]+/g, ' ')
    .trim();
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
      } else {
        current = candidate;
      }

      // A word wider than the box has to be broken somewhere, whether it
      // started the line or was pushed onto one of its own.
      while (widthOf(font, current, fontSize) > usable && current.length > 1) {
        let cut = current.length - 1;
        while (cut > 1 && widthOf(font, current.slice(0, cut), fontSize) > usable) cut -= 1;
        lines.push(current.slice(0, cut));
        current = current.slice(cut);
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
