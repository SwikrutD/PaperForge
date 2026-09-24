import { describe, expect, it } from 'vitest';
import {
  cellsOf,
  detectTable,
  pageText,
  pageTextPreservingLayout,
  toBlocks,
  toLines,
} from '../../../src/conversion/analysis/layout';
import type { ExportTextItem } from '../../../src/shared/schemas/convert';

/**
 * Reading the geometry of a page.
 *
 * There are no paragraphs in a PDF and no tables: these are readings of where
 * the words sit, and the tests say what each reading is meant to get right —
 * and where it is meant to refuse rather than guess.
 */

/** A piece of text at a place, sized like ordinary body text. */
function at(text: string, x: number, y: number, height = 10): ExportTextItem {
  return { text, x, y, width: text.length * height * 0.5, height };
}

describe('finding the lines', () => {
  it('groups what shares a baseline, and orders them down the page', () => {
    const lines = toLines([
      at('world', 140, 700),
      at('Hello', 100, 700),
      at('Second line', 100, 680),
    ]);

    expect(lines.map((line) => line.text)).toEqual(['Hello world', 'Second line']);
    expect(lines[0]?.left).toBe(100);
  });

  it('keeps a superscript on the line it belongs to', () => {
    const lines = toLines([at('Total', 100, 700), at('2', 128, 704, 6)]);
    expect(lines).toHaveLength(1);
  });

  it('puts a space where the page leaves a gap', () => {
    const lines = toLines([at('Invoice', 100, 700), at('number', 160, 700)]);
    expect(lines[0]?.text).toBe('Invoice number');
  });

  it('leaves out what draws nothing', () => {
    expect(toLines([at('   ', 100, 700), at('', 120, 700)])).toHaveLength(0);
  });
});

describe('finding the paragraphs', () => {
  it('keeps lines of the same paragraph together', () => {
    const blocks = toBlocks(
      toLines([
        at('The first line of a paragraph', 100, 700),
        at('and the second line of it', 100, 688),
        at('and the third.', 100, 676),
      ]),
    );

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.text).toBe(
      'The first line of a paragraph and the second line of it and the third.',
    );
  });

  it('starts a new one where the page leaves a gap', () => {
    const blocks = toBlocks(
      toLines([at('First paragraph', 100, 700), at('Second paragraph', 100, 660)]),
    );
    expect(blocks).toHaveLength(2);
  });

  it('starts a new one where the text changes size', () => {
    const blocks = toBlocks(
      toLines([at('A heading', 100, 700, 20), at('Body text beneath it', 100, 676, 10)]),
    );

    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.heading).toBe(true);
    expect(blocks[1]?.heading).toBe(false);
  });

  it('does not call a long passage a heading', () => {
    const lines = toLines([
      at('A long passage set in a larger face', 100, 700, 14),
      at('that runs on for several lines', 100, 684, 14),
      at('and several more after that', 100, 668, 14),
      at('and keeps going still', 100, 652, 14),
    ]);
    expect(toBlocks(lines)[0]?.heading).toBe(false);
  });
});

describe('finding a table', () => {
  /** Three rows of three columns, as a table is drawn. */
  const table = [
    at('Item', 100, 700),
    at('Qty', 300, 700),
    at('Price', 420, 700),
    at('Widget', 100, 680),
    at('12', 300, 680),
    at('4.50', 420, 680),
    at('Sprocket', 100, 660),
    at('3', 300, 660),
    at('19.00', 420, 660),
  ];

  it('finds the columns the rows share', () => {
    const shape = detectTable(toLines(table));

    expect(shape).not.toBeNull();
    expect(shape?.columns).toHaveLength(3);
    expect(shape?.rows).toHaveLength(3);
  });

  it('splits a row into its cells', () => {
    const shape = detectTable(toLines(table));
    const first = shape?.rows[1];
    expect(first).toBeDefined();

    expect(cellsOf(first!, shape?.columns ?? [])).toEqual(['Widget', '12', '4.50']);
  });

  it('refuses a page of prose rather than inventing a table', () => {
    const prose = toLines([
      at('The quick brown fox jumps over the lazy dog', 100, 700),
      at('and then it does it again, at some length', 100, 686),
      at('and once more for good measure indeed', 100, 672),
    ]);
    expect(detectTable(prose)).toBeNull();
  });

  it('refuses two rows: that is not a shape yet', () => {
    const two = toLines([
      at('Item', 100, 700),
      at('Qty', 300, 700),
      at('Widget', 100, 680),
      at('12', 300, 680),
    ]);
    expect(detectTable(two)).toBeNull();
  });
});

describe('the words as text', () => {
  const lines = toLines([
    at('Invoice', 100, 700),
    at('ACME', 300, 700),
    at('Total', 100, 660),
    at('1250.50', 300, 660),
  ]);

  it('reads one line of the page to a line', () => {
    expect(pageText(lines)).toBe('Invoice ACME\nTotal 1250.50');
  });

  it('keeps the columns where the reader asks for the layout', () => {
    const preserved = pageTextPreservingLayout(lines);
    const [first = '', ...rest] = preserved.split('\n');

    expect(first.indexOf('ACME')).toBeGreaterThan(first.indexOf('Invoice') + 6);
    // The blank line stands for the space the page leaves between them.
    expect(rest.some((line) => line === '')).toBe(true);
    expect(preserved).toContain('1250.50');
  });
});
