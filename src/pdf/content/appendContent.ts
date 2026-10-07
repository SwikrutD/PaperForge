import { spliceBytes } from './editText';
import { parseContent } from './parser';

/**
 * Appending to a page's drawing without inheriting what the page left behind.
 *
 * Content added at the end of a stream is drawn in whatever graphics state the
 * stream ends in. Plenty of real pages end with a transform still applied (a
 * coordinate flip, a scale to tenths of a point), a clip, a transparency
 * state, or text settings such as an invisible render mode — and some never
 * close the last `q`, `BT` or marked-content sequence they opened. Anything
 * appended after that lands in the wrong place, clipped, faded or invisible.
 *
 * The cure is the one PDF itself offers: put the page's own drawing inside
 * `q … Q`, closing whatever it left open, so that the state after it is the
 * page's initial state. A page that already leaves nothing behind is left
 * byte for byte as it was, which also keeps repeated additions from nesting
 * the page one level deeper each time.
 */

/**
 * Operators whose effect outlasts the path or text object they appear in. At
 * the outermost level of a stream, any of them changes how appended content
 * is drawn. `Tf`, `TL` and colours are not here: everything PaperForge
 * appends sets its own.
 */
const LASTING = new Set(['cm', 'W', 'W*', 'gs', 'Tc', 'Tw', 'Tz', 'Ts', 'Tr']);

/** What a content stream leaves in force at its end. */
export interface LeftoverState {
  /** True when an operator at the outermost level changes lasting state. */
  changesState: boolean;
  /** `q` operations still open at the end. */
  openSaves: number;
  /** `Q` operations with no `q` to match, which pop state the page never saved. */
  strayRestores: number;
  /** True when the stream ends inside `BT … ET`. */
  inText: boolean;
  /** Marked-content sequences still open at the end. */
  openMarked: number;
}

export function leftoverState(content: Uint8Array): LeftoverState {
  let depth = 0;
  let strayRestores = 0;
  let inText = false;
  let openMarked = 0;
  let changesState = false;

  for (const operation of parseContent(content)) {
    switch (operation.operator) {
      case 'q':
        depth += 1;
        break;
      case 'Q':
        if (depth === 0) strayRestores += 1;
        else depth -= 1;
        break;
      case 'BT':
        inText = true;
        break;
      case 'ET':
        inText = false;
        break;
      case 'BDC':
      case 'BMC':
        openMarked += 1;
        break;
      case 'EMC':
        openMarked = Math.max(0, openMarked - 1);
        break;
      default:
        if (depth === 0 && LASTING.has(operation.operator)) changesState = true;
    }
  }

  return { changesState, openSaves: depth, strayRestores, inText, openMarked };
}

function isClean(state: LeftoverState): boolean {
  return (
    !state.changesState &&
    state.openSaves === 0 &&
    state.strayRestores === 0 &&
    !state.inText &&
    state.openMarked === 0
  );
}

/**
 * The page's content, closed off so that whatever follows it starts from the
 * page's initial graphics state. Returned unchanged when it already does.
 */
export function isolateContent(content: Uint8Array): Uint8Array {
  const state = leftoverState(content);
  if (isClean(state)) return content;

  // One `q` for the wrapper, plus one for every `Q` that would otherwise pop
  // state the page never saved — and with it the wrapper's own.
  const opening = 'q\n'.repeat(1 + state.strayRestores);
  // Close what the page left open, innermost first, then the wrapper.
  const closing = [
    state.inText ? 'ET' : '',
    'EMC\n'.repeat(state.openMarked).trim(),
    'Q\n'.repeat(state.openSaves).trim(),
    'Q',
  ]
    .filter((part) => part !== '')
    .join('\n');

  const opened = spliceBytes(content, { start: 0, end: 0 }, opening);
  return spliceBytes(opened, { start: opened.length, end: opened.length }, `\n${closing}\n`);
}

/** Appends a block to a page's content, drawn from the page's initial state. */
export function appendIsolated(content: Uint8Array, block: string): Uint8Array {
  const isolated = isolateContent(content);
  return spliceBytes(isolated, { start: isolated.length, end: isolated.length }, block);
}
