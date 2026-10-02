import { describe, expect, it } from 'vitest';
import { diffWords, editScript, wordsOf, type Word } from '../../../src/pdf/compare/textDiff';
import {
  lineRects,
  pageDifference,
  pairPages,
  sizeDifference,
  textDifferences,
  visualDifferences,
} from '../../../src/pdf/compare/model';
import { diffPixels } from '../../../src/pdf/compare/pixelDiff';

function words(text: string, y = 700): Word[] {
  return text.split(' ').map((word, index) => ({
    text: word,
    box: { x: 72 + index * 40, y, width: 30, height: 12 },
  }));
}

/** Applies an edit script to check it really turns one list into the other. */
function replay(a: string[], b: string[]): string[] {
  const script = editScript(a, b);
  if (script === null) throw new Error('no script');
  return script.flatMap((step) =>
    step.kind === 'delete'
      ? []
      : step.kind === 'insert'
        ? [b[step.index] as string]
        : [a[step.index] as string],
  );
}

describe('word differences', () => {
  it('finds the shortest set of edits', () => {
    const a = 'the quick brown fox jumps'.split(' ');
    const b = 'the slow brown fox leaps high'.split(' ');
    expect(replay(a, b)).toEqual(b);
    const script = editScript(a, b) ?? [];
    expect(script.filter((step) => step.kind !== 'same')).toHaveLength(5);
  });

  it('handles empty pages on either side', () => {
    expect(replay([], ['a', 'b'])).toEqual(['a', 'b']);
    expect(replay(['a'], [])).toEqual([]);
    expect(editScript([], [])).toEqual([]);
  });

  it('reports additions, removals and changes as runs of words', () => {
    const changes = diffWords(
      words('Payment is due within 30 days of delivery'),
      words('Payment is due within 45 days of the delivery'),
    );
    expect(changes.map((change) => change.kind)).toEqual(['changed', 'added']);
    expect(changes[0]?.before.map((word) => word.text)).toEqual(['30']);
    expect(changes[0]?.after.map((word) => word.text)).toEqual(['45']);
    expect(changes[1]?.after.map((word) => word.text)).toEqual(['the']);
  });

  it('finds nothing between identical pages', () => {
    expect(diffWords(words('same words here'), words('same words here'))).toEqual([]);
  });

  it('shares a run of text out between its words', () => {
    const result = wordsOf({
      pageNumber: 1,
      text: 'ab cd',
      offsets: [0],
      items: [{ str: 'ab cd', x: 100, y: 500, width: 50, height: 10 }],
    });
    expect(result.map((word) => [word.text, word.box.x, word.box.width])).toEqual([
      ['ab', 100, 20],
      ['cd', 130, 20],
    ]);
  });
});

describe('comparison model', () => {
  it('pairs pages by position, with an offset for an inserted page', () => {
    expect(pairPages(2, 3, 0)).toEqual([
      { index: 1, original: 1, revised: 1 },
      { index: 2, original: 2, revised: 2 },
      { index: 3, original: null, revised: 3 },
    ]);
    // The revision gained a cover page: original page 1 is revised page 2.
    expect(pairPages(2, 3, 1)).toEqual([
      { index: 1, original: null, revised: 1 },
      { index: 2, original: 1, revised: 2 },
      { index: 3, original: 2, revised: 3 },
    ]);
    expect(pairPages(3, 2, -1)[0]).toEqual({ index: 1, original: 1, revised: null });
  });

  it('describes text changes and where they are', () => {
    const [difference] = textDifferences(2, diffWords(words('net 30 days'), words('net 45 days')));
    expect(difference).toMatchObject({
      pair: 2,
      kind: 'textChanged',
      summary: '“30” → “45”',
    });
    expect(difference?.originalRects).toHaveLength(1);
  });

  it('joins the words of a change into one box a line', () => {
    const rects = lineRects([...words('one two', 700), ...words('three', 680)]);
    expect(rects).toEqual([
      { x: 72, y: 700, width: 70, height: 12 },
      { x: 72, y: 680, width: 30, height: 12 },
    ]);
  });

  it('leaves out picture changes a text change already explains', () => {
    const differences = visualDifferences(
      1,
      [
        { original: { x: 70, y: 695, width: 40, height: 20 }, revised: null },
        { original: { x: 300, y: 100, width: 100, height: 100 }, revised: null },
      ],
      { original: [{ x: 72, y: 700, width: 30, height: 12 }], revised: [] },
    );
    expect(differences).toHaveLength(1);
    expect(differences[0]?.kind).toBe('visual');
  });

  it('reports a page with no partner, and a change of page size', () => {
    expect(pageDifference({ index: 4, original: null, revised: 4 })?.kind).toBe('pageAdded');
    expect(pageDifference({ index: 4, original: 4, revised: 4 })).toBeNull();
    expect(
      sizeDifference(1, { width: 612, height: 792 }, { width: 595, height: 842 })?.summary,
    ).toBe('Page size changed: 612 × 792 → 595 × 842 pt');
    expect(
      sizeDifference(1, { width: 612, height: 792 }, { width: 612.4, height: 792 }),
    ).toBeNull();
  });
});

describe('pixel differences', () => {
  function canvas(
    width: number,
    height: number,
    paint?: (x: number, y: number) => boolean,
  ): Uint8ClampedArray {
    const data = new Uint8ClampedArray(width * height * 4).fill(255);
    if (paint !== undefined) {
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          if (!paint(x, y)) continue;
          const at = (y * width + x) * 4;
          data[at] = 0;
          data[at + 1] = 0;
          data[at + 2] = 0;
        }
      }
    }
    return data;
  }

  it('finds the region that changed and nothing else', () => {
    const original = canvas(100, 100);
    const revised = canvas(100, 100, (x, y) => x >= 40 && x < 60 && y >= 10 && y < 20);
    const result = diffPixels({ width: 100, height: 100, original, revised, overlay: true });

    expect(result.regions).toEqual([{ left: 40, top: 8, width: 24, height: 16 }]);
    expect(result.changedRatio).toBeCloseTo(0.02);
    // Added ink is painted blue in the difference picture.
    const at = (15 * 100 + 50) * 4;
    expect(Array.from(result.overlay?.subarray(at, at + 3) ?? [])).toEqual([30, 100, 220]);
  });

  it('keeps separate changes separate, and identical pages clean', () => {
    const original = canvas(200, 200);
    const revised = canvas(
      200,
      200,
      (x, y) => (x < 10 && y < 10) || (x >= 150 && x < 160 && y >= 150 && y < 160),
    );
    expect(
      diffPixels({ width: 200, height: 200, original, revised, overlay: false }).regions,
    ).toHaveLength(2);
    expect(
      diffPixels({ width: 200, height: 200, original, revised: original, overlay: false }),
    ).toMatchObject({ regions: [], changedRatio: 0, overlay: null });
  });
});
