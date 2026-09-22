import { describe, expect, it } from 'vitest';
import { resolvePageEntry } from '../../../src/renderer/components/viewer/pageEntry';

// A preface numbered in roman numerals, then the body from 1.
const LABELS = ['i', 'ii', 'iii', '1', '2'];
const NO_LABELS = [null, null, null, null, null];

describe('resolvePageEntry', () => {
  it('reads a plain page number', () => {
    expect(resolvePageEntry('4', NO_LABELS, 5)).toBe(4);
  });

  it('clamps a number to the pages the document has', () => {
    expect(resolvePageEntry('99', NO_LABELS, 5)).toBe(5);
    expect(resolvePageEntry('0', NO_LABELS, 5)).toBe(1);
  });

  it('reads a page label, ignoring case and spacing', () => {
    expect(resolvePageEntry('iii', LABELS, 5)).toBe(3);
    expect(resolvePageEntry(' II ', LABELS, 5)).toBe(2);
  });

  // "1" is both the fourth page's label and a page number; the label wins,
  // because it is what the reader sees printed on the page.
  it('prefers a label over the same text as a number', () => {
    expect(resolvePageEntry('1', LABELS, 5)).toBe(4);
  });

  it('has nothing to go to for text that is neither', () => {
    expect(resolvePageEntry('', LABELS, 5)).toBeNull();
    expect(resolvePageEntry('later', LABELS, 5)).toBeNull();
  });
});
