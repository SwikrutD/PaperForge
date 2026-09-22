import { describe, expect, it } from 'vitest';
import type { PdfPageText } from '../../../src/pdf/render/types';
import {
  excerptForMatch,
  findMatchesInText,
  firstMatchFromPage,
  rectsForMatch,
  searchPage,
} from '../../../src/pdf/search/textSearch';

function pageText(runs: Array<{ str: string; x: number; width: number }>): PdfPageText {
  const items = runs.map((run) => ({
    str: run.str,
    x: run.x,
    y: 700,
    width: run.width,
    height: 12,
  }));
  const offsets: number[] = [];
  let text = '';
  for (const item of items) {
    offsets.push(text.length);
    text += item.str;
  }
  return { pageNumber: 1, text, items, offsets };
}

describe('findMatchesInText', () => {
  it('finds every occurrence, ignoring case by default', () => {
    expect(findMatchesInText('Annual Report annual report', 'annual')).toEqual([
      { start: 0, end: 6 },
      { start: 14, end: 20 },
    ]);
  });

  it('respects case sensitivity when asked', () => {
    const matches = findMatchesInText('Annual annual', 'annual', {
      caseSensitive: true,
      wholeWord: false,
    });
    expect(matches).toEqual([{ start: 7, end: 13 }]);
  });

  it('matches whole words only when asked', () => {
    const text = 'report reporting reported report.';
    const loose = findMatchesInText(text, 'report');
    const strict = findMatchesInText(text, 'report', { caseSensitive: false, wholeWord: true });

    expect(loose).toHaveLength(4);
    expect(strict.map((match) => match.start)).toEqual([0, 26]);
  });

  it('treats the query as literal text, not a pattern', () => {
    expect(findMatchesInText('total (net) 12.50', '(net)')).toEqual([{ start: 6, end: 11 }]);
    expect(findMatchesInText('a.b acb', 'a.b')).toEqual([{ start: 0, end: 3 }]);
  });

  it('reports overlapping occurrences', () => {
    expect(findMatchesInText('aaaa', 'aa')).toHaveLength(3);
  });

  it('returns nothing for an empty query or empty text', () => {
    expect(findMatchesInText('something', '')).toEqual([]);
    expect(findMatchesInText('', 'something')).toEqual([]);
  });

  it('handles non-ASCII text', () => {
    expect(findMatchesInText('Rapport financier é 日本語', 'é')).toHaveLength(1);
    expect(findMatchesInText('日本語の文書', '本語')).toEqual([{ start: 1, end: 3 }]);
  });
});

describe('rectsForMatch', () => {
  const page = pageText([
    { str: 'Hello ', x: 100, width: 60 },
    { str: 'world', x: 160, width: 50 },
  ]);

  it('covers a match inside one run', () => {
    const [rect, ...rest] = rectsForMatch(page, 0, 5);
    expect(rest).toHaveLength(0);
    expect(rect).toMatchObject({ x: 100, y: 700, height: 12 });
    expect(rect?.width).toBeCloseTo(50, 5);
  });

  it('splits a match that spans two runs', () => {
    const rects = rectsForMatch(page, 3, 8);
    expect(rects).toHaveLength(2);
    expect(rects[0]?.x).toBeCloseTo(130, 5);
    expect(rects[1]?.x).toBeCloseTo(160, 5);
    expect(rects[1]?.width).toBeCloseTo(20, 5);
  });

  it('ignores runs with no width', () => {
    const odd = pageText([{ str: 'invisible', x: 0, width: 0 }]);
    expect(rectsForMatch(odd, 0, 3)).toEqual([]);
  });
});

describe('searchPage', () => {
  const page = pageText([
    { str: 'The annual report ', x: 72, width: 180 },
    { str: 'covers the annual results.', x: 72, width: 260 },
  ]);

  it('returns matches with rectangles and an excerpt', () => {
    const matches = searchPage(page, 'annual');

    expect(matches).toHaveLength(2);
    expect(matches[0]?.pageNumber).toBe(1);
    expect(matches[0]?.rects.length).toBeGreaterThan(0);
    expect(matches[0]?.excerpt).toContain('annual');
  });

  it('finds nothing in a page with no text, which is what a scan looks like', () => {
    expect(searchPage(pageText([]), 'anything')).toEqual([]);
  });
});

describe('result navigation', () => {
  const matches = [
    { pageNumber: 1, start: 0, end: 1, excerpt: '', rects: [] },
    { pageNumber: 4, start: 0, end: 1, excerpt: '', rects: [] },
    { pageNumber: 9, start: 0, end: 1, excerpt: '', rects: [] },
  ];

  it('starts from the page the reader is on', () => {
    expect(firstMatchFromPage(matches, 1)).toBe(0);
    expect(firstMatchFromPage(matches, 4)).toBe(1);
    expect(firstMatchFromPage(matches, 5)).toBe(2);
    expect(firstMatchFromPage(matches, 20)).toBe(0);
  });
});

describe('excerptForMatch', () => {
  it('trims around the match and marks where it was cut', () => {
    const text = `${'a'.repeat(80)} target ${'b'.repeat(80)}`;
    const excerpt = excerptForMatch(text, 81, 87);

    expect(excerpt.startsWith('…')).toBe(true);
    expect(excerpt.endsWith('…')).toBe(true);
    expect(excerpt).toContain('target');
    expect(excerpt.length).toBeLessThan(text.length);
  });
});
