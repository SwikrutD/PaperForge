/**
 * Page range parsing, shared by everything that asks the reader which pages to
 * work on: search, export, OCR, print.
 *
 * Accepts the notation people already use in print dialogs — `1-5, 8, 12-` —
 * with `-4` meaning "up to 4" and an open end meaning "to the last page".
 */

export type PageRange =
  | { kind: 'all' }
  /** Sorted, de-duplicated, one-based page numbers within the document. */
  | { kind: 'pages'; pages: number[] }
  | { kind: 'invalid'; message: string };

const SEPARATOR = /[,;]/;

function invalid(message: string): PageRange {
  return { kind: 'invalid', message };
}

/**
 * Parses a page range against a document of `pageCount` pages.
 *
 * An empty string means every page, which is what a blank field should do.
 * A reversed range such as `9-4` is read as `4-9` rather than rejected.
 */
export function parsePageRange(input: string, pageCount: number): PageRange {
  const text = input.trim();
  if (text === '') return { kind: 'all' };
  if (pageCount <= 0) return invalid('The document has no pages.');

  const pages = new Set<number>();

  for (const rawPart of text.split(SEPARATOR)) {
    const part = rawPart.trim();
    if (part === '') continue;

    const dash = part.indexOf('-');
    if (dash < 0) {
      const single = toPageNumber(part, pageCount);
      if (typeof single === 'string') return invalid(single);
      pages.add(single);
      continue;
    }

    const fromText = part.slice(0, dash).trim();
    const toText = part.slice(dash + 1).trim();
    const from = fromText === '' ? 1 : toPageNumber(fromText, pageCount);
    const to = toText === '' ? pageCount : toPageNumber(toText, pageCount);
    if (typeof from === 'string') return invalid(from);
    if (typeof to === 'string') return invalid(to);

    for (let page = Math.min(from, to); page <= Math.max(from, to); page += 1) pages.add(page);
  }

  if (pages.size === 0) return invalid('Enter at least one page.');
  return { kind: 'pages', pages: [...pages].sort((a, b) => a - b) };
}

/** A page number, or the reason the text is not one. */
function toPageNumber(text: string, pageCount: number): number | string {
  if (!/^\d+$/.test(text)) return `“${text}” is not a page number.`;
  const value = Number.parseInt(text, 10);
  if (value < 1 || value > pageCount) {
    return `This document has pages 1 to ${pageCount}.`;
  }
  return value;
}

/** True when the range covers this page. Invalid ranges cover nothing. */
export function pageRangeIncludes(range: PageRange, pageNumber: number): boolean {
  if (range.kind === 'all') return true;
  if (range.kind === 'invalid') return false;
  return range.pages.includes(pageNumber);
}

/** The pages a range resolves to, in order. */
export function pagesInRange(range: PageRange, pageCount: number): number[] {
  if (range.kind === 'invalid') return [];
  if (range.kind === 'pages') return range.pages;
  return Array.from({ length: Math.max(0, pageCount) }, (_, index) => index + 1);
}

/** Writes page numbers back out in the same notation, collapsing runs. */
export function formatPageRange(pages: readonly number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const parts: string[] = [];

  let index = 0;
  while (index < sorted.length) {
    const start = sorted[index] as number;
    let end = start;
    while (index + 1 < sorted.length && sorted[index + 1] === end + 1) {
      index += 1;
      end = sorted[index] as number;
    }
    parts.push(start === end ? String(start) : `${start}-${end}`);
    index += 1;
  }
  return parts.join(', ');
}
