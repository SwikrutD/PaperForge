import type { PdfPageText } from '../render/types';

/**
 * Word-level differences between the text of two pages.
 *
 * The words are compared as they come out of each page, in the order the
 * document gives them, with Myers' algorithm: the shortest list of
 * insertions and deletions that turns one into the other. A deletion next to
 * an insertion is reported as a change. Nothing here guesses at meaning —
 * "changed" means only that these words were replaced by those.
 */

export interface WordBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Word {
  text: string;
  /** Where the word sits on its page, in PDF user space. */
  box: WordBox;
}

export type TextChangeKind = 'added' | 'removed' | 'changed';

export interface TextChange {
  kind: TextChangeKind;
  /** The words as the original had them; empty for an addition. */
  before: Word[];
  /** The words as the revision has them; empty for a removal. */
  after: Word[];
}

/** Beyond this many edits the pages have little in common, and are reported as rewritten. */
const MAX_EDITS = 1500;

/**
 * The words of a page with a box each. A run of text is shared out between
 * its words by character count, which is exact for even spacing and close
 * enough to draw a highlight anywhere else.
 */
export function wordsOf(page: PdfPageText): Word[] {
  const words: Word[] = [];
  for (const item of page.items) {
    const length = item.str.length;
    if (length === 0) continue;
    const perCharacter = item.width / length;
    const pattern = /\S+/g;
    for (const match of item.str.matchAll(pattern)) {
      const start = match.index;
      words.push({
        text: match[0],
        box: {
          x: item.x + start * perCharacter,
          // The run's origin is its baseline; descenders reach a little below.
          y: item.y - item.height * 0.2,
          width: Math.max(1, match[0].length * perCharacter),
          height: Math.max(1, item.height),
        },
      });
    }
  }
  return words;
}

export function diffWords(before: readonly Word[], after: readonly Word[]): TextChange[] {
  const script = editScript(
    before.map((word) => word.text),
    after.map((word) => word.text),
  );
  if (script === null) {
    // Too different to align word by word: the whole page was rewritten.
    if (before.length === 0 && after.length === 0) return [];
    return [
      {
        kind: before.length === 0 ? 'added' : after.length === 0 ? 'removed' : 'changed',
        before: [...before],
        after: [...after],
      },
    ];
  }

  const changes: TextChange[] = [];
  let removed: Word[] = [];
  let added: Word[] = [];
  const flush = (): void => {
    if (removed.length === 0 && added.length === 0) return;
    changes.push({
      kind: removed.length === 0 ? 'added' : added.length === 0 ? 'removed' : 'changed',
      before: removed,
      after: added,
    });
    removed = [];
    added = [];
  };

  for (const step of script) {
    if (step.kind === 'same') flush();
    else if (step.kind === 'delete') removed.push(before[step.index] as Word);
    else added.push(after[step.index] as Word);
  }
  flush();
  return changes;
}

type Step = { kind: 'same' | 'delete' | 'insert'; index: number };

/**
 * Myers' O((N+M)D) difference: the shortest edit script, or null when it
 * would need more than `MAX_EDITS` edits.
 */
export function editScript(a: readonly string[], b: readonly string[]): Step[] | null {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, MAX_EDITS);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  // The frontier as it stood before each round, for walking back.
  const trace: Int32Array[] = [];

  for (let d = 0; d <= max; d += 1) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = goesDown(v, offset, k, d) ? at(v, offset, k + 1) : at(v, offset, k - 1) + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) return backtrack(trace, n, m, offset);
    }
  }
  return null;
}

function at(v: Int32Array, offset: number, k: number): number {
  return v[offset + k] ?? 0;
}

/** Whether diagonal k is reached by an insertion (from k + 1) rather than a deletion. */
function goesDown(v: Int32Array, offset: number, k: number, d: number): boolean {
  return k === -d || (k !== d && at(v, offset, k - 1) < at(v, offset, k + 1));
}

function backtrack(trace: readonly Int32Array[], n: number, m: number, offset: number): Step[] {
  const steps: Step[] = [];
  let x = n;
  let y = m;

  for (let d = trace.length - 1; d >= 0; d -= 1) {
    const v = trace[d] as Int32Array;
    const k = x - y;
    const previousK = goesDown(v, offset, k, d) ? k + 1 : k - 1;
    const previousX = at(v, offset, previousK);
    const previousY = previousX - previousK;

    while (x > previousX && y > previousY) {
      x -= 1;
      y -= 1;
      steps.push({ kind: 'same', index: x });
    }
    if (d === 0) break;
    if (x === previousX) steps.push({ kind: 'insert', index: previousY });
    else steps.push({ kind: 'delete', index: previousX });
    x = previousX;
    y = previousY;
  }
  return steps.reverse();
}
