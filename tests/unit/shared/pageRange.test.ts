import { describe, expect, it } from 'vitest';
import {
  formatPageRange,
  pageRangeIncludes,
  pagesInRange,
  parsePageRange,
} from '../../../src/shared/utils/pageRange';

describe('parsePageRange', () => {
  it('reads a blank field as every page', () => {
    expect(parsePageRange('', 10)).toEqual({ kind: 'all' });
    expect(parsePageRange('   ', 10)).toEqual({ kind: 'all' });
  });

  it('reads single pages and ranges', () => {
    expect(parsePageRange('3', 10)).toEqual({ kind: 'pages', pages: [3] });
    expect(parsePageRange('2-4', 10)).toEqual({ kind: 'pages', pages: [2, 3, 4] });
  });

  it('reads a list with mixed separators and spacing', () => {
    expect(parsePageRange(' 1 , 3-5 ; 9 ', 10)).toEqual({
      kind: 'pages',
      pages: [1, 3, 4, 5, 9],
    });
  });

  it('sorts and de-duplicates overlapping parts', () => {
    expect(parsePageRange('5,1-3,2', 10)).toEqual({ kind: 'pages', pages: [1, 2, 3, 5] });
  });

  it('reads an open end as the rest of the document', () => {
    expect(parsePageRange('8-', 10)).toEqual({ kind: 'pages', pages: [8, 9, 10] });
  });

  it('reads an open start as the beginning of the document', () => {
    expect(parsePageRange('-3', 10)).toEqual({ kind: 'pages', pages: [1, 2, 3] });
  });

  it('reads a reversed range in the order the document has', () => {
    expect(parsePageRange('9-7', 10)).toEqual({ kind: 'pages', pages: [7, 8, 9] });
  });

  it('rejects text that is not a page number', () => {
    const result = parsePageRange('1, last', 10);
    expect(result.kind).toBe('invalid');
    expect(result).toHaveProperty('message', '“last” is not a page number.');
  });

  it('rejects pages the document does not have', () => {
    expect(parsePageRange('11', 10)).toEqual({
      kind: 'invalid',
      message: 'This document has pages 1 to 10.',
    });
    expect(parsePageRange('0', 10)).toEqual({
      kind: 'invalid',
      message: 'This document has pages 1 to 10.',
    });
  });

  it('rejects separators with nothing between them', () => {
    expect(parsePageRange(',,', 10)).toEqual({
      kind: 'invalid',
      message: 'Enter at least one page.',
    });
  });

  it('has nothing to offer for an empty document', () => {
    expect(parsePageRange('1', 0)).toEqual({
      kind: 'invalid',
      message: 'The document has no pages.',
    });
  });
});

describe('pageRangeIncludes', () => {
  it('covers every page when the range is all', () => {
    expect(pageRangeIncludes({ kind: 'all' }, 7)).toBe(true);
  });

  it('covers only the listed pages', () => {
    const range = parsePageRange('2-3', 10);
    expect(pageRangeIncludes(range, 2)).toBe(true);
    expect(pageRangeIncludes(range, 4)).toBe(false);
  });

  it('covers nothing when the range could not be read', () => {
    expect(pageRangeIncludes({ kind: 'invalid', message: 'no' }, 1)).toBe(false);
  });
});

describe('pagesInRange', () => {
  it('expands all to the whole document', () => {
    expect(pagesInRange({ kind: 'all' }, 3)).toEqual([1, 2, 3]);
  });

  it('keeps a listed range as it is', () => {
    expect(pagesInRange(parsePageRange('2,5', 10), 10)).toEqual([2, 5]);
  });

  it('expands an unreadable range to nothing', () => {
    expect(pagesInRange({ kind: 'invalid', message: 'no' }, 10)).toEqual([]);
  });
});

describe('formatPageRange', () => {
  it('collapses runs and keeps single pages', () => {
    expect(formatPageRange([1, 2, 3, 7, 9, 10])).toBe('1-3, 7, 9-10');
  });

  it('sorts and de-duplicates first', () => {
    expect(formatPageRange([4, 2, 2, 3])).toBe('2-4');
  });

  it('writes nothing for no pages', () => {
    expect(formatPageRange([])).toBe('');
  });
});
