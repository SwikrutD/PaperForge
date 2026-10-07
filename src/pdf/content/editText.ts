import type { FontMetrics } from './fonts';
import type { ByteRange } from './parser';
import type { TextRun } from './textRuns';
import { formatNumber, formatValue } from './values';

/**
 * Writing a run of text back into the content stream it came from.
 *
 * This is the native rewrite — Tier A of `docs/EDITING_MODEL.md`: the bytes
 * that hold the run's text are replaced, and everything else in the stream is
 * left exactly as it was. It is only possible when the font the run is drawn
 * in can write every character of the new text; when it cannot, the caller is
 * told which character stopped it rather than being given a broken page.
 */

export interface EncodedText {
  bytes: Uint8Array;
  /** Composite fonts are written as hexadecimal, which is how they read. */
  hex: boolean;
}

export type EncodeResult =
  | { ok: true; encoded: EncodedText }
  /** The first character the font has no code for. */
  | { ok: false; missing: string };

/** Turns text into the codes a font draws it with. */
export function encodeForFont(font: FontMetrics, text: string): EncodeResult {
  const codes: number[] = [];

  for (const character of text) {
    const code = font.codeFor(character);
    if (code === null) return { ok: false, missing: character };
    codes.push(code);
  }

  if (font.singleByte) {
    return {
      ok: true,
      encoded: { bytes: Uint8Array.from(codes.map((code) => code & 0xff)), hex: false },
    };
  }

  const bytes = new Uint8Array(codes.length * 2);
  codes.forEach((code, index) => {
    bytes[index * 2] = (code >> 8) & 0xff;
    bytes[index * 2 + 1] = code & 0xff;
  });
  return { ok: true, encoded: { bytes, hex: true } };
}

/**
 * A run's text as a show operation writes it: strings of codes, with the gaps
 * between words as `TJ` adjustments where the run spaces its words that way.
 */
export type RunPiece = EncodedText | number;

export type RunEncodeResult =
  | { ok: true; pieces: RunPiece[] }
  /** The first character the run's font has no code for. */
  | { ok: false; missing: string };

/** How far a word gap moves the pen when the run has none to copy: a quarter em. */
const DEFAULT_WORD_GAP = -250;

/**
 * How a run writes the space between words: the way it already does.
 *
 * A run that draws space characters keeps drawing them. A run that separates
 * its words with `TJ` gaps — as pdfTeX, Quartz and many other generators do —
 * keeps doing that, with the gap it used. A run with neither uses its font's
 * space when the font has a visible one, and a gap when it has none.
 */
function spaceOf(run: TextRun, font: FontMetrics): { code: number } | { gap: number } {
  const drawn = run.glyphs.find((glyph) => glyph.text === ' ');
  if (drawn !== undefined) return { code: drawn.code };
  if (run.wordGap !== null) return { gap: run.wordGap };
  const code = font.codeFor(' ');
  if (code !== null && font.width(code) > 0) return { code };
  return { gap: DEFAULT_WORD_GAP };
}

/** Turns text into what the run's show operation writes, spaces included. */
export function encodeRunText(run: TextRun, font: FontMetrics, text: string): RunEncodeResult {
  const space = spaceOf(run, font);
  const pieces: RunPiece[] = [];
  let word = '';

  const flush = (): RunEncodeResult | null => {
    if (word === '') return null;
    const encoded = encodeForFont(font, word);
    word = '';
    if (!encoded.ok) return encoded;
    pieces.push(encoded.encoded);
    return null;
  };

  for (const character of text) {
    if (character !== ' ' || 'code' in space) {
      word += character;
      continue;
    }
    const failed = flush();
    if (failed !== null) return failed;
    // Consecutive spaces are one wider gap.
    const last = pieces[pieces.length - 1];
    if (typeof last === 'number') pieces[pieces.length - 1] = last + space.gap;
    else pieces.push(space.gap);
  }
  const failed = flush();
  if (failed !== null) return failed;
  return { ok: true, pieces };
}

/** How a show operation spells its text once it has been re-encoded. */
export function formatShowOperand(operator: string, encoded: EncodedText): string {
  const value = formatValue({ kind: 'string', bytes: encoded.bytes, hex: encoded.hex });
  // A TJ takes an array; rewriting one collapses its pieces into a single
  // string, which is the whole point — the offsets belonged to the old text.
  return operator === 'TJ' ? `[${value}]` : value;
}

/** Replaces one range of a content stream with something else. */
export function spliceBytes(bytes: Uint8Array, range: ByteRange, replacement: string): Uint8Array {
  // The replacement is Latin-1 by construction: names, numbers and escaped
  // string bytes, never characters that need more than a byte.
  const replacementBytes = latin1Bytes(replacement);

  const result = new Uint8Array(range.start + replacementBytes.length + (bytes.length - range.end));
  result.set(bytes.subarray(0, range.start), 0);
  result.set(replacementBytes, range.start);
  result.set(bytes.subarray(range.end), range.start + replacementBytes.length);
  return result;
}

function latin1Bytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) {
    bytes[index] = text.charCodeAt(index) & 0xff;
  }
  return bytes;
}

export type RewriteResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: 'no-font' | 'unsupported-character'; character?: string };

/**
 * Rewrites a run's text in the page's content, returning the new content.
 *
 * Only the run's own operand changes. Whatever follows it on the line moves
 * with it if the stream positioned it relatively, and stays where it is if the
 * stream positioned it absolutely — which is exactly what the original PDF
 * would have done had it been written with the new text.
 */
export function rewriteRunText(content: Uint8Array, run: TextRun, text: string): RewriteResult {
  if (run.font === null) return { ok: false, reason: 'no-font' };

  const encoded = encodeRunText(run, run.font, text);
  if (!encoded.ok) {
    return { ok: false, reason: 'unsupported-character', character: encoded.missing };
  }

  const strings = encoded.pieces.filter((piece): piece is EncodedText => typeof piece !== 'number');
  const gaps = encoded.pieces.length !== strings.length;

  // No gaps: the run's text operand is replaced, and nothing else.
  if (!gaps) {
    const joined = joinEncoded(strings, run.font.singleByte);
    return {
      ok: true,
      bytes: spliceBytes(content, run.textRange, formatShowOperand(run.operator, joined)),
    };
  }

  // Gaps need a TJ array. A TJ keeps its operator; a Tj, ' or " becomes a TJ,
  // with the line move a quote operator made written out first.
  const array = `[${encoded.pieces
    .map((piece) =>
      typeof piece === 'number'
        ? formatNumber(piece)
        : formatValue({ kind: 'string', bytes: piece.bytes, hex: piece.hex }),
    )
    .join(' ')}]`;
  return {
    ok: true,
    bytes:
      run.operator === 'TJ'
        ? spliceBytes(content, run.textRange, array)
        : spliceBytes(content, run.operationRange, `${lineMoveFor(run)}${array} TJ`),
  };
}

/** Several encoded strings as one, for a run written without gaps. */
function joinEncoded(strings: readonly EncodedText[], singleByte: boolean): EncodedText {
  const total = strings.reduce((sum, piece) => sum + piece.bytes.length, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const piece of strings) {
    bytes.set(piece.bytes, offset);
    offset += piece.bytes.length;
  }
  return { bytes, hex: !singleByte };
}

/** What `'` and `"` do before they show, written as operators of their own. */
export function lineMoveFor(run: TextRun): string {
  if (run.operator === "'") return 'T* ';
  if (run.operator === '"') {
    return `${formatNumber(run.wordSpacing)} Tw ${formatNumber(run.charSpacing)} Tc T* `;
  }
  return '';
}

/** Whether a run can be rewritten in place, and why not when it cannot. */
export function rewritability(run: TextRun): { editable: boolean; reason?: string } {
  if (run.font === null) {
    return { editable: false, reason: 'PaperForge cannot tell which font drew this text.' };
  }
  if (run.glyphs.some((glyph) => glyph.text === null)) {
    return {
      editable: false,
      reason: 'This font does not say what its characters are, so its text cannot be read back.',
    };
  }
  // A font that cannot write back the text it is already showing cannot write
  // anything else either. Spaces it shows as gaps are written as gaps.
  if (!encodeRunText(run, run.font, run.text).ok) {
    return {
      editable: false,
      reason: 'This font is written in a way PaperForge cannot add characters to.',
    };
  }
  return { editable: true };
}
