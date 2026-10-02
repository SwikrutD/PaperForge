import type { ByteRange, ContentOperation } from '../content/parser';
import { applyMatrix } from '../content/state';
import { lineMoveFor } from '../content/drawText';
import { runBounds, type TextRun } from '../content/textRuns';
import { formatNumber, formatValue, type ContentValue } from '../content/values';
import {
  GLYPH_COVERAGE,
  area,
  boundsOfPoints,
  containsPoint,
  inflate,
  overlapArea,
  touchesAny,
  type Point,
  type Rect,
} from './geometry';

/**
 * Taking glyphs out of a run of text.
 *
 * A glyph under a mark is not hidden, it is removed: its character code is
 * deleted from the show operation and replaced by a `TJ` offset that moves the
 * pen just as far, so every glyph that stays is drawn exactly where it was.
 * Nothing about the font is needed beyond how it splits a string into codes,
 * which is why this works for fonts PaperForge could never write new text in.
 */

/** A change to a content stream: these bytes become those. */
export interface ContentEdit {
  range: ByteRange;
  replacement: string;
}

/** Where a glyph is drawn, in user space. */
export interface GlyphBox {
  bounds: Rect;
  centre: Point;
}

/** Ascent and descent a font is drawn with when it states nothing sensible. */
const FALLBACK_ASCENT = 750;
const FALLBACK_DESCENT = -200;

/** The box every glyph of a run occupies, from the same geometry that drew it. */
export function glyphBoxes(run: TextRun): GlyphBox[] {
  const ascentUnits = (run.font?.ascent ?? 0) > 0 ? (run.font?.ascent ?? 0) : FALLBACK_ASCENT;
  const descentUnits = (run.font?.descent ?? 0) < 0 ? (run.font?.descent ?? 0) : FALLBACK_DESCENT;
  const top = (ascentUnits / 1000) * run.fontSize + run.rise;
  const bottom = (descentUnits / 1000) * run.fontSize + run.rise;

  return run.glyphs.map((glyph) => {
    const left = glyph.offset;
    const right = glyph.offset + glyph.advance;
    const bounds = boundsOfPoints([
      applyMatrix(run.matrix, left, bottom),
      applyMatrix(run.matrix, right, bottom),
      applyMatrix(run.matrix, left, top),
      applyMatrix(run.matrix, right, top),
    ]);
    return { bounds, centre: applyMatrix(run.matrix, (left + right) / 2, (top + bottom) / 2) };
  });
}

/** True when a mark takes this glyph: its middle is under it, or most of it is. */
export function glyphCovered(box: GlyphBox, marks: readonly Rect[]): boolean {
  const size = area(box.bounds);
  return marks.some(
    (mark) =>
      containsPoint(mark, box.centre) ||
      (size > 0 && overlapArea(mark, box.bounds) >= size * GLYPH_COVERAGE),
  );
}

/** True when PaperForge knows where each of this run's glyphs actually is. */
export function runMeasurable(run: TextRun): boolean {
  return run.font !== null && run.font.positionsKnown;
}

/**
 * Whether a run PaperForge cannot measure might lie under a mark.
 *
 * Its glyphs are wherever the font says, and the font has not said, so the
 * estimate is widened by the size of the text before it is compared.
 */
export function unmeasurableRunTouches(run: TextRun, marks: readonly Rect[]): boolean {
  const bounds = runBounds(run);
  const slack = Math.max(2, bounds.height, Math.abs(run.fontSize));
  return touchesAny(marks, inflate(bounds, slack));
}

type Piece =
  { kind: 'string'; bytes: Uint8Array; hex: boolean } | { kind: 'offset'; amount: number };

/** The strings and offsets a show operation draws, as written. */
function piecesOf(operation: ContentOperation): Piece[] | null {
  const { operator, operands } = operation;
  const asPiece = (value: ContentValue | undefined): Piece | null => {
    if (value?.kind === 'string') return { kind: 'string', bytes: value.bytes, hex: value.hex };
    if (value?.kind === 'number') return { kind: 'offset', amount: value.value };
    return null;
  };

  if (operator === 'Tj' || operator === "'") {
    const piece = asPiece(operands[0]);
    return piece?.kind === 'string' ? [piece] : null;
  }
  if (operator === '"') {
    const piece = asPiece(operands[2]);
    return piece?.kind === 'string' ? [piece] : null;
  }
  if (operator === 'TJ') {
    const array = operands[0];
    if (array?.kind !== 'array') return null;
    // Anything that is neither a string nor a number moves nothing.
    return array.items.map(asPiece).filter((piece): piece is Piece => piece !== null);
  }
  return null;
}

/** The bytes of each code in a string, split the way the font splits it. */
function codeChunks(bytes: Uint8Array, singleByte: boolean): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  const step = singleByte ? 1 : 2;
  for (let index = 0; index < bytes.length; index += step) {
    chunks.push(bytes.subarray(index, Math.min(bytes.length, index + step)));
  }
  return chunks;
}

/**
 * Rewrites a show operation without the glyphs marked for removal.
 *
 * Returns null when the operation does not split into the glyphs the run was
 * measured with, which means PaperForge does not understand it well enough to
 * cut it — the caller falls back rather than guessing.
 */
export function cutRun(
  run: TextRun,
  operation: ContentOperation,
  removed: readonly boolean[],
): ContentEdit | null {
  if (run.font === null) return null;
  const pieces = piecesOf(operation);
  if (pieces === null) return null;

  const scale = (run.horizontalScale === 0 ? 100 : run.horizontalScale) / 100;
  // A TJ number n moves the pen by -n/1000 × size × scale.
  const offsetFor = (advance: number): number =>
    run.fontSize === 0 ? 0 : -(advance * 1000) / (run.fontSize * scale);

  const output: Piece[] = [];
  const pushOffset = (amount: number): void => {
    const last = output[output.length - 1];
    if (last?.kind === 'offset') last.amount += amount;
    else output.push({ kind: 'offset', amount });
  };
  const pushBytes = (bytes: Uint8Array, hex: boolean): void => {
    const last = output[output.length - 1];
    if (last?.kind === 'string' && last.hex === hex) {
      const joined = new Uint8Array(last.bytes.length + bytes.length);
      joined.set(last.bytes, 0);
      joined.set(bytes, last.bytes.length);
      last.bytes = joined;
    } else {
      output.push({ kind: 'string', bytes: Uint8Array.from(bytes), hex });
    }
  };

  let glyphIndex = 0;
  for (const piece of pieces) {
    if (piece.kind === 'offset') {
      pushOffset(piece.amount);
      continue;
    }
    for (const chunk of codeChunks(piece.bytes, run.font.singleByte)) {
      const glyph = run.glyphs[glyphIndex];
      if (glyph === undefined) return null;
      if (removed[glyphIndex] === true) pushOffset(offsetFor(glyph.advance));
      else pushBytes(chunk, piece.hex);
      glyphIndex += 1;
    }
  }
  if (glyphIndex !== run.glyphs.length) return null;

  const items = output
    .filter((piece) => piece.kind === 'string' || Math.abs(piece.amount) > 1e-6)
    .map((piece) =>
      piece.kind === 'string'
        ? formatValue({ kind: 'string', bytes: piece.bytes, hex: piece.hex })
        : formatNumber(Math.round(piece.amount * 10_000) / 10_000),
    );

  // `'` and `"` move to the next line before they show; that move is written
  // out on its own, because a `TJ` does not make it.
  return {
    range: operation.range,
    replacement: `${lineMoveFor(run)}[${items.join(' ')}] TJ`,
  };
}
