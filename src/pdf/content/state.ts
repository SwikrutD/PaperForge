import type { ContentOperation } from './parser';
import { nameOf, numberOf, numbersOf, type ContentValue } from './values';

/**
 * What a content stream is doing at each point: where it is drawing, at what
 * size, in what font and in what colour.
 *
 * Only what text editing needs is tracked — the transform, the text state and
 * the fill colour. Paths, clipping and shading pass through untouched.
 */

/** A PDF transformation matrix, as `[a b c d e f]` is written. */
export interface Matrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/** `first` applied, then `second` — the order a content stream concatenates. */
export function multiply(first: Matrix, second: Matrix): Matrix {
  return {
    a: first.a * second.a + first.b * second.c,
    b: first.a * second.b + first.b * second.d,
    c: first.c * second.a + first.d * second.c,
    d: first.c * second.b + first.d * second.d,
    e: first.e * second.a + first.f * second.c + second.e,
    f: first.e * second.b + first.f * second.d + second.f,
  };
}

export function applyMatrix(matrix: Matrix, x: number, y: number): { x: number; y: number } {
  return {
    x: matrix.a * x + matrix.c * y + matrix.e,
    y: matrix.b * x + matrix.d * y + matrix.f,
  };
}

/** Horizontal and vertical scale a matrix applies, ignoring rotation. */
export function matrixScale(matrix: Matrix): { x: number; y: number } {
  return {
    x: Math.hypot(matrix.a, matrix.b),
    y: Math.hypot(matrix.c, matrix.d),
  };
}

/** The angle a matrix turns text through, in degrees clockwise from upright. */
export function matrixRotation(matrix: Matrix): number {
  const degrees = (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI;
  return Math.round(((degrees % 360) + 360) % 360);
}

export type ColorSpaceKind = 'gray' | 'rgb' | 'cmyk' | 'other';

export interface Color {
  space: ColorSpaceKind;
  /** Components as the operator gave them, 0–1 for the device spaces. */
  components: number[];
}

export const BLACK: Color = { space: 'gray', components: [0] };

export interface TextState {
  /** Resource name of the font, without its slash. */
  fontName: string | null;
  fontSize: number;
  /** `Tc`, in unscaled text units. */
  charSpacing: number;
  /** `Tw`, applied to the single-byte code 32 only. */
  wordSpacing: number;
  /** `Tz`, as a percentage. */
  horizontalScale: number;
  /** `TL`, the distance between baselines. */
  leading: number;
  /** `Ts`, the baseline shift. */
  rise: number;
  /** `Tr`: 3 and 7 draw nothing, which is what an OCR layer uses. */
  renderMode: number;
}

export const INITIAL_TEXT_STATE: TextState = {
  fontName: null,
  fontSize: 0,
  charSpacing: 0,
  wordSpacing: 0,
  horizontalScale: 100,
  leading: 0,
  rise: 0,
  renderMode: 0,
};

export interface GraphicsState {
  ctm: Matrix;
  text: TextState;
  fill: Color;
  stroke: Color;
}

export function initialGraphicsState(ctm: Matrix = IDENTITY): GraphicsState {
  return { ctm, text: { ...INITIAL_TEXT_STATE }, fill: BLACK, stroke: BLACK };
}

/**
 * Runs a content stream, calling back at each operation with the state as it
 * stands.
 *
 * Text matrices are part of the walk rather than the state stack, because
 * `BT` resets them and `ET` ends their life — they do not survive `q`/`Q`.
 */
export interface WalkContext {
  operation: ContentOperation;
  index: number;
  state: GraphicsState;
  /** The text matrix, valid between `BT` and `ET`. */
  textMatrix: Matrix;
  /** The line matrix a `T*` or `Td` moves from. */
  lineMatrix: Matrix;
  /** True while between `BT` and `ET`. */
  inText: boolean;
}

/**
 * How far a show operation moved the text matrix. The walker cannot know this
 * — it depends on the font's widths — so the caller says.
 */
export type ShowAdvance = (context: WalkContext) => number;

export interface WalkOptions {
  /** The transform the page puts on its content, if any. */
  ctm?: Matrix;
  /** Called for every operation, before the state changes it makes. */
  onOperation?: (context: WalkContext) => void;
  /** Advance in unscaled text units for `Tj`, `TJ`, `'` and `"`. */
  advanceOf?: ShowAdvance;
}

const SHOW_OPERATORS = new Set(['Tj', 'TJ', "'", '"']);

export function walkContent(
  operations: readonly ContentOperation[],
  options: WalkOptions = {},
): void {
  const stack: GraphicsState[] = [];
  let state = initialGraphicsState(options.ctm ?? IDENTITY);
  let textMatrix = IDENTITY;
  let lineMatrix = IDENTITY;
  let inText = false;

  /** Moves to the start of the next line, `tx ty` from the current one. */
  const nextLine = (tx: number, ty: number): void => {
    lineMatrix = multiply({ a: 1, b: 0, c: 0, d: 1, e: tx, f: ty }, lineMatrix);
    textMatrix = lineMatrix;
  };

  operations.forEach((operation, index) => {
    const context: WalkContext = { operation, index, state, textMatrix, lineMatrix, inText };
    options.onOperation?.(context);

    const { operator, operands } = operation;
    switch (operator) {
      case 'q':
        stack.push({ ...state, text: { ...state.text } });
        break;
      case 'Q': {
        const restored = stack.pop();
        if (restored !== undefined) state = restored;
        break;
      }
      case 'cm':
        state = { ...state, ctm: multiply(matrixFrom(operands), state.ctm) };
        break;

      case 'BT':
        inText = true;
        textMatrix = IDENTITY;
        lineMatrix = IDENTITY;
        break;
      case 'ET':
        inText = false;
        break;

      case 'Tf':
        state = {
          ...state,
          text: {
            ...state.text,
            fontName: nameOf(operands[0]),
            fontSize: numberOf(operands[1]),
          },
        };
        break;
      case 'Tc':
        state = { ...state, text: { ...state.text, charSpacing: numberOf(operands[0]) } };
        break;
      case 'Tw':
        state = { ...state, text: { ...state.text, wordSpacing: numberOf(operands[0]) } };
        break;
      case 'Tz':
        state = {
          ...state,
          text: { ...state.text, horizontalScale: numberOf(operands[0], 100) },
        };
        break;
      case 'TL':
        state = { ...state, text: { ...state.text, leading: numberOf(operands[0]) } };
        break;
      case 'Ts':
        state = { ...state, text: { ...state.text, rise: numberOf(operands[0]) } };
        break;
      case 'Tr':
        state = { ...state, text: { ...state.text, renderMode: numberOf(operands[0]) } };
        break;

      case 'Td':
        nextLine(numberOf(operands[0]), numberOf(operands[1]));
        break;
      case 'TD':
        state = { ...state, text: { ...state.text, leading: -numberOf(operands[1]) } };
        nextLine(numberOf(operands[0]), numberOf(operands[1]));
        break;
      case 'Tm':
        lineMatrix = matrixFrom(operands);
        textMatrix = lineMatrix;
        break;
      case 'T*':
        nextLine(0, -state.text.leading);
        break;

      case "'":
        nextLine(0, -state.text.leading);
        break;
      case '"':
        state = {
          ...state,
          text: {
            ...state.text,
            wordSpacing: numberOf(operands[0]),
            charSpacing: numberOf(operands[1]),
          },
        };
        nextLine(0, -state.text.leading);
        break;

      case 'g':
        state = { ...state, fill: { space: 'gray', components: numbersOf(operands) } };
        break;
      case 'G':
        state = { ...state, stroke: { space: 'gray', components: numbersOf(operands) } };
        break;
      case 'rg':
        state = { ...state, fill: { space: 'rgb', components: numbersOf(operands) } };
        break;
      case 'RG':
        state = { ...state, stroke: { space: 'rgb', components: numbersOf(operands) } };
        break;
      case 'k':
        state = { ...state, fill: { space: 'cmyk', components: numbersOf(operands) } };
        break;
      case 'K':
        state = { ...state, stroke: { space: 'cmyk', components: numbersOf(operands) } };
        break;
      case 'sc':
      case 'scn':
        state = { ...state, fill: colorFrom(operands) };
        break;
      case 'SC':
      case 'SCN':
        state = { ...state, stroke: colorFrom(operands) };
        break;

      default:
        break;
    }

    // A show operation moves the text matrix along by what it drew.
    if (SHOW_OPERATORS.has(operator)) {
      const advance = options.advanceOf?.({ ...context, textMatrix, lineMatrix, state }) ?? 0;
      if (advance !== 0) {
        textMatrix = multiply({ a: 1, b: 0, c: 0, d: 1, e: advance, f: 0 }, textMatrix);
      }
    }
  });
}

function matrixFrom(operands: readonly ContentValue[]): Matrix {
  return {
    a: numberOf(operands[0], 1),
    b: numberOf(operands[1]),
    c: numberOf(operands[2]),
    d: numberOf(operands[3], 1),
    e: numberOf(operands[4]),
    f: numberOf(operands[5]),
  };
}

/** A colour set through a named space: read the numbers, name the rest. */
function colorFrom(operands: readonly ContentValue[]): Color {
  const components = numbersOf(operands);
  switch (components.length) {
    case 1:
      return { space: 'gray', components };
    case 3:
      return { space: 'rgb', components };
    case 4:
      return { space: 'cmyk', components };
    default:
      return { space: 'other', components };
  }
}
