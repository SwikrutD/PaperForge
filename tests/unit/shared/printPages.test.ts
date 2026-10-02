import { describe, expect, it } from 'vitest';
import { selectPrintPages, type PrintPageChoice } from '../../../src/shared/utils/printPages';

const choice = (patch: Partial<PrintPageChoice>): PrintPageChoice => ({
  scope: 'all',
  rangeText: '',
  subset: 'all',
  currentPage: 1,
  pageCount: 10,
  ...patch,
});

describe('selectPrintPages', () => {
  it('prints every page, the current page, or a range', () => {
    expect(selectPrintPages(choice({ pageCount: 3 }))).toEqual({ kind: 'pages', pages: [1, 2, 3] });
    expect(selectPrintPages(choice({ scope: 'current', currentPage: 7 }))).toEqual({
      kind: 'pages',
      pages: [7],
    });
    expect(selectPrintPages(choice({ scope: 'range', rangeText: '2-4, 9' }))).toEqual({
      kind: 'pages',
      pages: [2, 3, 4, 9],
    });
  });

  it('keeps odd or even page numbers', () => {
    expect(selectPrintPages(choice({ scope: 'range', rangeText: '3-8', subset: 'even' }))).toEqual({
      kind: 'pages',
      pages: [4, 6, 8],
    });
    expect(selectPrintPages(choice({ pageCount: 5, subset: 'odd' }))).toEqual({
      kind: 'pages',
      pages: [1, 3, 5],
    });
  });

  it('explains a choice that leaves nothing to print', () => {
    expect(selectPrintPages(choice({ scope: 'range', rangeText: '' })).kind).toBe('invalid');
    expect(selectPrintPages(choice({ scope: 'range', rangeText: '12' }))).toEqual({
      kind: 'invalid',
      message: 'This document has pages 1 to 10.',
    });
    expect(selectPrintPages(choice({ scope: 'current', currentPage: 3, subset: 'even' }))).toEqual({
      kind: 'invalid',
      message: 'Those pages include no even pages.',
    });
    expect(selectPrintPages(choice({ pageCount: 0 })).kind).toBe('invalid');
  });

  it('keeps the current page within the document', () => {
    expect(selectPrintPages(choice({ scope: 'current', currentPage: 40 }))).toEqual({
      kind: 'pages',
      pages: [10],
    });
  });
});
