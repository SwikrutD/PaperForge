import type { TextRun } from './textRuns';
import { formatNumber, formatValue } from './values';
import { spliceBytes } from './editText';
import type { Matrix } from './state';

/**
 * Drawing text PaperForge writes itself, and taking text out of a page
 * without disturbing what is around it.
 *
 * This is Tier B of `docs/EDITING_MODEL.md`: when the font a run is drawn in
 * cannot write what the reader typed, the original glyphs are taken out — the
 * show operation is replaced by one that draws nothing but moves the pen
 * exactly as far — and the new text is drawn over the page in a font
 * PaperForge controls.
 */

export interface DrawnTextStyle {
  /** Resource name of the font to draw with, without its slash. */
  fontResource: string;
  size: number;
  color: { r: number; g: number; b: number };
  charSpacing?: number;
  wordSpacing?: number;
  /** Percentage, as `Tz` takes it. */
  horizontalScale?: number;
  rise?: number;
}

/**
 * Replaces a run with something that draws nothing and advances just as far.
 *
 * `[ n ] TJ` moves the pen without drawing: a negative number in a `TJ` array
 * moves it forward. Keeping the advance is what stops the rest of the line
 * from sliding left when the run it followed stops drawing.
 */
export function neutralizeRun(content: Uint8Array, run: TextRun): Uint8Array {
  const advance = advanceOf(run);
  const scale = (run.horizontalScale === 0 ? 100 : run.horizontalScale) / 100;
  // tx = -n/1000 × size × scale, so n = -advance × 1000 / (size × scale).
  const displacement = run.fontSize === 0 ? 0 : -((advance * 1000) / (run.fontSize * scale));

  const replacement = `[${formatNumber(round(displacement))}] TJ`;
  // The whole operation goes, because `'` and `"` cannot become a `TJ` on
  // their own: their line move is written out first.
  const prefix = lineMoveFor(run);
  return spliceBytes(content, run.operationRange, `${prefix}${replacement}`);
}

/** What `'` and `"` do before they show, written as operators of their own. */
export function lineMoveFor(run: TextRun): string {
  if (run.operator === "'") return 'T* ';
  if (run.operator === '"') {
    return `${formatNumber(run.wordSpacing)} Tw ${formatNumber(run.charSpacing)} Tc T* `;
  }
  return '';
}

/** How far a run moves the pen, in unscaled text units. */
export function advanceOf(run: TextRun): number {
  const last = run.glyphs[run.glyphs.length - 1];
  return last === undefined ? 0 : last.offset + last.advance;
}

/**
 * Appends a block of text to a page's content, drawn at a given transform.
 *
 * It is appended rather than inserted, so it is drawn last: over whatever was
 * there, which is what replacing text has to do. `q`/`Q` keep the block's own
 * state to itself.
 */
export function appendTextBlock(
  content: Uint8Array,
  matrix: Matrix,
  text: Uint8Array,
  style: DrawnTextStyle,
  hex = false,
): Uint8Array {
  const parts: string[] = [
    'q',
    'BT',
    `${formatNumber(style.color.r)} ${formatNumber(style.color.g)} ${formatNumber(style.color.b)} rg`,
    `/${style.fontResource} ${formatNumber(style.size)} Tf`,
  ];

  if (style.charSpacing !== undefined && style.charSpacing !== 0) {
    parts.push(`${formatNumber(style.charSpacing)} Tc`);
  }
  if (style.wordSpacing !== undefined && style.wordSpacing !== 0) {
    parts.push(`${formatNumber(style.wordSpacing)} Tw`);
  }
  if (style.horizontalScale !== undefined && style.horizontalScale !== 100) {
    parts.push(`${formatNumber(style.horizontalScale)} Tz`);
  }
  if (style.rise !== undefined && style.rise !== 0) {
    parts.push(`${formatNumber(style.rise)} Ts`);
  }

  parts.push(
    `${formatNumber(round(matrix.a))} ${formatNumber(round(matrix.b))} ${formatNumber(
      round(matrix.c),
    )} ${formatNumber(round(matrix.d))} ${formatNumber(round(matrix.e))} ${formatNumber(
      round(matrix.f),
    )} Tm`,
  );
  parts.push(`${formatValue({ kind: 'string', bytes: text, hex })} Tj`);
  parts.push('ET', 'Q');

  const block = `\n${parts.join('\n')}\n`;
  return spliceBytes(content, { start: content.length, end: content.length }, block);
}

/** Six decimal places is more than a page ever needs, and keeps files small. */
function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
