import { describe, expect, it } from 'vitest';
import {
  chooseInitialIndex,
  highlightsByPage,
  stepIndex,
} from '../../../src/renderer/components/search/searchNavigation';
import type { SearchHit } from '../../../src/renderer/stores/searchStore';

function hit(sessionId: string, pageNumber: number, start = 0): SearchHit {
  return {
    sessionId,
    id: `${sessionId}:${pageNumber}:${start}`,
    pageNumber,
    start,
    end: start + 4,
    excerpt: 'match',
    rects: [{ x: 10, y: 20, width: 30, height: 12 }],
  };
}

describe('chooseInitialIndex', () => {
  const hits = [hit('a', 1), hit('a', 5), hit('a', 9)];

  it('lands on the first match at or after the page being read', () => {
    expect(chooseInitialIndex(hits, 'a', 4)).toBe(1);
    expect(chooseInitialIndex(hits, 'a', 5)).toBe(1);
  });

  it('falls back to the first match in the document past the last one', () => {
    expect(chooseInitialIndex(hits, 'a', 20)).toBe(0);
  });

  it('falls back to the first match anywhere when the document has none', () => {
    const mixed = [hit('b', 3), hit('a', 7)];
    expect(chooseInitialIndex(mixed, 'c', 1)).toBe(0);
    expect(chooseInitialIndex(mixed, 'a', 1)).toBe(1);
  });

  it('has nothing to land on without matches', () => {
    expect(chooseInitialIndex([], 'a', 1)).toBe(-1);
  });
});

describe('stepIndex', () => {
  it('wraps around both ends', () => {
    expect(stepIndex(0, 3, 1)).toBe(1);
    expect(stepIndex(2, 3, 1)).toBe(0);
    expect(stepIndex(0, 3, -1)).toBe(2);
  });

  it('starts at either end when the reader is on no match', () => {
    expect(stepIndex(-1, 3, 1)).toBe(0);
    expect(stepIndex(-1, 3, -1)).toBe(2);
  });

  it('stays nowhere when there are no matches', () => {
    expect(stepIndex(-1, 0, 1)).toBe(-1);
  });
});

describe('highlightsByPage', () => {
  const hits = [hit('a', 1), hit('a', 3), hit('b', 3)];

  it('groups the matches of one document by page and marks the current one', () => {
    const pages = highlightsByPage(hits, 'a', 1, true);

    expect([...pages.keys()]).toEqual([1, 3]);
    expect(pages.get(1)?.[0]?.active).toBe(false);
    expect(pages.get(3)?.[0]?.active).toBe(true);
  });

  it('leaves other documents alone', () => {
    const pages = highlightsByPage(hits, 'b', 2, true);
    expect([...pages.keys()]).toEqual([3]);
    expect(pages.get(3)).toHaveLength(1);
  });

  it('draws only the current match when highlight all is off', () => {
    const pages = highlightsByPage(hits, 'a', 1, false);
    expect([...pages.keys()]).toEqual([3]);
    expect(pages.get(3)?.[0]?.active).toBe(true);
  });

  it('gives every rectangle of a match its own identity', () => {
    const wide: SearchHit = {
      ...hit('a', 2),
      rects: [
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 20, y: 0, width: 10, height: 10 },
      ],
    };
    const pages = highlightsByPage([wide], 'a', 0, true);
    expect(pages.get(2)?.map((entry) => entry.id)).toEqual(['a:2:0:0', 'a:2:0:1']);
  });

  it('has nothing to draw without matches', () => {
    expect(highlightsByPage([], 'a', -1, true).size).toBe(0);
  });
});
