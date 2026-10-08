import type { ByteRange, ContentOperation } from './parser';
import type { FontLookup, FontMetrics } from './fonts';
import {
  applyMatrix,
  matrixRotation,
  matrixScale,
  multiply,
  walkContent,
  type Color,
  type ColorSpaceLookup,
  type Matrix,
  type TextState,
} from './state';
import type { ContentValue } from './values';

/**
 * The text a page draws, as runs.
 *
 * A run is one show operation — `Tj`, `TJ`, `'` or `"` — with everything
 * needed to put a box around it on screen and to write it back: what it says,
 * where it sits, which font drew it, and exactly which bytes of the stream
 * hold its text.
 */

export interface Glyph {
  code: number;
  /** What the code says, or null when the font does not say. */
  text: string | null;
  /** How far this glyph moves the pen, in unscaled text units. */
  advance: number;
  /** Distance from the run's start to this glyph, in unscaled text units. */
  offset: number;
}

export interface TextRun {
  /** Index of the operation in the parsed stream. */
  operationIndex: number;
  operator: string;
  /** The operand holding the text: a string, or the array of a `TJ`. */
  textRange: ByteRange;
  /** The whole operation, for replacing it outright. */
  operationRange: ByteRange;
  fontName: string | null;
  font: FontMetrics | null;
  fontSize: number;
  /**
   * What the run says, as far as the font allows it to be read — with a
   * space wherever a `TJ` gap separates two words, as a reader sees it.
   */
  text: string;
  /**
   * The `TJ` adjustment the run separates its words with, as written (a
   * negative number), or null when it draws no such gap. Writing the run back
   * uses it, so a run that spaced its words with gaps keeps doing so.
   */
  wordGap: number | null;
  glyphs: Glyph[];
  /** Text space to user space at the start of the run. */
  matrix: Matrix;
  /** Where the baseline starts, in user space. */
  origin: { x: number; y: number };
  /** Width along the baseline, in user space. */
  width: number;
  /** Ascender to descender, in user space. */
  height: number;
  /** How far the text is turned, in degrees clockwise. */
  rotation: number;
  color: Color;
  /** 3 and 7 draw nothing: an OCR layer, or text hidden behind an image. */
  invisible: boolean;
  charSpacing: number;
  wordSpacing: number;
  horizontalScale: number;
  rise: number;
}

/** What a show operation drew, before the state machine moves on. */
interface ShowParts {
  /** The string operands, with the `TJ` offsets between them. */
  pieces: Array<{ kind: 'string'; bytes: Uint8Array } | { kind: 'offset'; amount: number }>;
  textRange: ByteRange | null;
}

function showParts(operation: ContentOperation): ShowParts {
  const { operator, operands, operandRanges } = operation;

  if (operator === 'Tj' || operator === "'") {
    const value = operands[0];
    return value?.kind === 'string'
      ? { pieces: [{ kind: 'string', bytes: value.bytes }], textRange: operandRanges[0] ?? null }
      : { pieces: [], textRange: null };
  }

  if (operator === '"') {
    // aw ac string "
    const value = operands[2];
    return value?.kind === 'string'
      ? { pieces: [{ kind: 'string', bytes: value.bytes }], textRange: operandRanges[2] ?? null }
      : { pieces: [], textRange: null };
  }

  if (operator === 'TJ') {
    const value = operands[0];
    if (value?.kind !== 'array') return { pieces: [], textRange: null };
    return {
      pieces: value.items.map((item: ContentValue) =>
        item.kind === 'string'
          ? ({ kind: 'string', bytes: item.bytes } as const)
          : ({ kind: 'offset', amount: item.kind === 'number' ? item.value : 0 } as const),
      ),
      textRange: operandRanges[0] ?? null,
    };
  }

  return { pieces: [], textRange: null };
}

/**
 * A `TJ` gap at least this much of the font size wide separates words. It is
 * the threshold PDF.js reads a space at, so the editor and the page agree on
 * where the spaces are; kerning between letters is far smaller.
 */
const WORD_GAP_EM = 0.102;

/** The glyphs of a show operation, what they say, and how far it moves the pen. */
function measure(
  parts: ShowParts,
  font: FontMetrics | null,
  text: TextState,
): { glyphs: Glyph[]; advance: number; said: string; wordGap: number | null } {
  const glyphs: Glyph[] = [];
  const scale = text.horizontalScale / 100;
  let advance = 0;
  let said = '';
  let wordGap: number | null = null;
  // A gap only becomes a space once another glyph follows it.
  let gapPending = false;

  for (const piece of parts.pieces) {
    if (piece.kind === 'offset') {
      // A positive number in a TJ array moves the text back.
      advance += (-piece.amount / 1000) * text.fontSize * scale;
      if (-piece.amount / 1000 >= WORD_GAP_EM && glyphs.length > 0 && !said.endsWith(' ')) {
        gapPending = true;
        wordGap ??= piece.amount;
      }
      continue;
    }

    const codes = font?.codes(piece.bytes) ?? [...piece.bytes];
    for (const code of codes) {
      const width = (font?.width(code) ?? 500) / 1000;
      const isSpace = code === 32 && (font?.singleByte ?? true);
      const step =
        (width * text.fontSize + text.charSpacing + (isSpace ? text.wordSpacing : 0)) * scale;

      const glyphText = font?.unicode(code) ?? null;
      if (gapPending && glyphText !== ' ') said += ' ';
      gapPending = false;
      said += glyphText ?? '';

      glyphs.push({ code, text: glyphText, advance: step, offset: advance });
      advance += step;
    }
  }

  return { glyphs, advance, said, wordGap };
}

export interface TextRunOptions {
  fonts: FontLookup;
  /** The transform the page puts on its content, if any. */
  ctm?: Matrix;
  /** The colour spaces the page's resources define, for `cs` and `scn`. */
  colorSpaces?: ColorSpaceLookup;
}

/** Reads every run of text a content stream draws. */
export function extractTextRuns(
  operations: readonly ContentOperation[],
  options: TextRunOptions,
): TextRun[] {
  const runs: TextRun[] = [];

  walkContent(operations, {
    ...(options.ctm === undefined ? {} : { ctm: options.ctm }),
    ...(options.colorSpaces === undefined ? {} : { colorSpaces: options.colorSpaces }),
    advanceOf: (context) => {
      const parts = showParts(context.operation);
      const state = context.state;
      const font =
        state.text.fontName === null ? null : (options.fonts(state.text.fontName) ?? null);
      const { glyphs, advance, said, wordGap } = measure(parts, font, state.text);

      if (parts.textRange !== null && glyphs.length > 0) {
        runs.push(
          buildRun(
            context.operation,
            context.index,
            glyphs,
            { advance, said, wordGap },
            context.textMatrix,
            state.ctm,
            state.text,
            state.fill,
            font,
            parts.textRange,
          ),
        );
      }
      return advance;
    },
  });

  return runs;
}

function buildRun(
  operation: ContentOperation,
  operationIndex: number,
  glyphs: Glyph[],
  { advance, said, wordGap }: { advance: number; said: string; wordGap: number | null },
  textMatrix: Matrix,
  ctm: Matrix,
  text: TextState,
  color: Color,
  font: FontMetrics | null,
  textRange: ByteRange,
): TextRun {
  // Text space is the text matrix on top of whatever the page is doing.
  const matrix = multiply(textMatrix, ctm);
  const origin = applyMatrix(matrix, 0, text.rise);
  const scale = matrixScale(matrix);

  const ascent = ((font?.ascent ?? 750) / 1000) * text.fontSize;
  const descent = ((font?.descent ?? -250) / 1000) * text.fontSize;

  return {
    operationIndex,
    operator: operation.operator,
    textRange,
    operationRange: operation.range,
    fontName: text.fontName,
    font,
    fontSize: text.fontSize,
    text: said,
    wordGap,
    glyphs,
    matrix,
    origin,
    width: advance * scale.x,
    height: (ascent - descent) * scale.y,
    rotation: matrixRotation(matrix),
    color,
    invisible: text.renderMode === 3 || text.renderMode === 7,
    charSpacing: text.charSpacing,
    wordSpacing: text.wordSpacing,
    horizontalScale: text.horizontalScale,
    rise: text.rise,
  };
}

/**
 * The box a run occupies in user space.
 *
 * Only upright and quarter-turned text gets a tight box; anything else gets
 * the box that contains it, which is what a selection rectangle needs.
 */
export function runBounds(run: TextRun): { x: number; y: number; width: number; height: number } {
  const ascent = ((run.font?.ascent ?? 750) / 1000) * run.fontSize;
  const descent = ((run.font?.descent ?? -250) / 1000) * run.fontSize;

  const corners = [
    applyMatrix(run.matrix, 0, descent + run.rise),
    applyMatrix(run.matrix, 0, ascent + run.rise),
    applyMatrix(run.matrix, advanceInTextSpace(run), descent + run.rise),
    applyMatrix(run.matrix, advanceInTextSpace(run), ascent + run.rise),
  ];

  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/**
 * The size a run appears at on the page: its font size scaled by the text
 * matrix and the page's transform. Many generators draw at `1 Tf` and scale
 * the matrix instead, so `fontSize` alone can say one point for text that is
 * plainly twelve.
 */
export function seenFontSize(run: TextRun): number {
  return run.fontSize * matrixScale(run.matrix).y;
}

/** The run's advance before the matrix scales it. */
function advanceInTextSpace(run: TextRun): number {
  const last = run.glyphs[run.glyphs.length - 1];
  return last === undefined ? 0 : last.offset + last.advance;
}
