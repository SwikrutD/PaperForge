import type { PdfPageText } from '../render/types';

export interface SearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
}

export const DEFAULT_SEARCH_OPTIONS: SearchOptions = {
  caseSensitive: false,
  wholeWord: false,
};

/** A rectangle in PDF user space: origin bottom-left. */
export interface SearchRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SearchMatch {
  pageNumber: number;
  /** Offsets into the page's joined text. */
  start: number;
  end: number;
  /** Text as it appears in the document, for the results list. */
  excerpt: string;
  rects: SearchRect[];
}

const WORD_CHARACTER = /[\p{L}\p{N}_]/u;

function isWordBoundary(text: string, index: number): boolean {
  const character = text[index];
  return character === undefined || !WORD_CHARACTER.test(character);
}

/**
 * Finds every occurrence of `query` in `text`.
 *
 * Plain scanning rather than a regular expression, so a query containing
 * regex punctuation searches for exactly those characters.
 */
export function findMatchesInText(
  text: string,
  query: string,
  options: SearchOptions = DEFAULT_SEARCH_OPTIONS,
): Array<{ start: number; end: number }> {
  if (query === '' || text === '') return [];

  const haystack = options.caseSensitive ? text : text.toLowerCase();
  const needle = options.caseSensitive ? query : query.toLowerCase();

  const matches: Array<{ start: number; end: number }> = [];
  let from = 0;

  for (;;) {
    const index = haystack.indexOf(needle, from);
    if (index < 0) break;
    const end = index + needle.length;

    const boundedStart = !options.wholeWord || isWordBoundary(text, index - 1);
    const boundedEnd = !options.wholeWord || isWordBoundary(text, end);
    if (boundedStart && boundedEnd) matches.push({ start: index, end });

    // Overlapping matches are reported, which is what a reader expects when
    // searching for "aa" in "aaa".
    from = index + 1;
  }
  return matches;
}

/**
 * Rectangles covering a match, one per text run it spans.
 *
 * Characters within a run are assumed to be evenly spaced. That is exact for
 * monospaced text and close enough elsewhere for a highlight; PaperForge never
 * uses these rectangles for anything but drawing.
 */
export function rectsForMatch(page: PdfPageText, start: number, end: number): SearchRect[] {
  const rects: SearchRect[] = [];

  for (const [index, item] of page.items.entries()) {
    const itemStart = page.offsets[index] ?? 0;
    const itemEnd = itemStart + item.str.length;
    if (itemEnd <= start) continue;
    if (itemStart >= end) break;
    if (item.str.length === 0 || item.width === 0) continue;

    const from = Math.max(start, itemStart) - itemStart;
    const to = Math.min(end, itemEnd) - itemStart;
    const perCharacter = item.width / item.str.length;

    rects.push({
      x: item.x + from * perCharacter,
      // The item's y is its baseline; the box sits above it.
      y: item.y,
      width: (to - from) * perCharacter,
      height: item.height,
    });
  }
  return rects;
}

/** A short piece of the page text around a match, for the results list. */
export function excerptForMatch(text: string, start: number, end: number, radius = 34): string {
  const from = Math.max(0, start - radius);
  const to = Math.min(text.length, end + radius);
  const prefix = from > 0 ? '…' : '';
  const suffix = to < text.length ? '…' : '';
  return `${prefix}${text.slice(from, to).replace(/\s+/g, ' ').trim()}${suffix}`;
}

/** Every match on one page, with the rectangles needed to highlight them. */
export function searchPage(
  page: PdfPageText,
  query: string,
  options: SearchOptions = DEFAULT_SEARCH_OPTIONS,
): SearchMatch[] {
  return findMatchesInText(page.text, query, options).map(({ start, end }) => ({
    pageNumber: page.pageNumber,
    start,
    end,
    excerpt: excerptForMatch(page.text, start, end),
    rects: rectsForMatch(page, start, end),
  }));
}

/** Index of the first match at or after a page, for "find next" from here. */
export function firstMatchFromPage(matches: readonly SearchMatch[], pageNumber: number): number {
  const index = matches.findIndex((match) => match.pageNumber >= pageNumber);
  return index < 0 ? 0 : index;
}
