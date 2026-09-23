import type { FontMetrics } from './fonts';
import type { ByteRange } from './parser';
import type { TextRun } from './textRuns';
import { formatValue } from './values';

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

  const encoded = encodeForFont(run.font, text);
  if (!encoded.ok) {
    return { ok: false, reason: 'unsupported-character', character: encoded.missing };
  }

  return {
    ok: true,
    bytes: spliceBytes(content, run.textRange, formatShowOperand(run.operator, encoded.encoded)),
  };
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
  // anything else either.
  const sample = run.text;
  for (const character of sample) {
    if (run.font.codeFor(character) === null) {
      return {
        editable: false,
        reason: 'This font is written in a way PaperForge cannot add characters to.',
      };
    }
  }
  return { editable: true };
}
