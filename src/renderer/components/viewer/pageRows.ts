/**
 * How pages pair up into rows. A row is what the reader sees side by side:
 * one page in a plain column, two in a spread. With a cover page the first
 * page stands alone, on the right, and the pairs after it start on an even
 * page — the way a printed book opens.
 *
 * Rows are worked out arithmetically rather than stored, so asking which row
 * page 900 of a thousand-page document sits in costs nothing.
 */
export type SpreadMode = 'none' | 'twoPage';

export interface RowOptions {
  spread: SpreadMode;
  /** In a spread, the first page stands alone. Ignored without a spread. */
  cover?: boolean;
}

/** The row options a tab's view asks for. */
export function rowOptionsFor(view: { spread: SpreadMode; coverPage: boolean }): RowOptions {
  return { spread: view.spread, cover: view.coverPage };
}

function hasCover(options: RowOptions): boolean {
  return options.spread === 'twoPage' && options.cover === true;
}

/** Zero-based index of the row a page sits in. */
export function rowIndexOf(pageNumber: number, options: RowOptions): number {
  const page = Math.max(1, pageNumber);
  if (options.spread !== 'twoPage') return page - 1;
  return hasCover(options) ? Math.floor(page / 2) : Math.floor((page - 1) / 2);
}

/** The pages in a row, left to right, leaving out any past the end of the document. */
export function rowPages(rowIndex: number, pageCount: number, options: RowOptions): number[] {
  let first = rowIndex + 1;
  let last = first;
  if (hasCover(options)) {
    first = rowIndex === 0 ? 1 : rowIndex * 2;
    last = rowIndex === 0 ? 1 : first + 1;
  } else if (options.spread === 'twoPage') {
    first = rowIndex * 2 + 1;
    last = first + 1;
  }
  const pages: number[] = [];
  for (let pageNumber = first; pageNumber <= Math.min(last, pageCount); pageNumber += 1) {
    pages.push(pageNumber);
  }
  return pages;
}

/** The row containing a page. */
export function rowOf(pageNumber: number, pageCount: number, options: RowOptions): number[] {
  return rowPages(rowIndexOf(pageNumber, options), pageCount, options);
}

/** How many rows the document makes. */
export function rowCount(pageCount: number, options: RowOptions): number {
  return pageCount <= 0 ? 0 : rowIndexOf(pageCount, options) + 1;
}

/**
 * The page to go to for "next page" and "previous page": the first page of
 * the row `offset` rows away, kept inside the document. In a spread that is
 * two pages on, not one, so next page never lands on the page already beside
 * the reader.
 */
export function stepPage(
  pageNumber: number,
  offset: number,
  pageCount: number,
  options: RowOptions,
): number {
  if (pageCount <= 0) return 1;
  const last = rowCount(pageCount, options) - 1;
  const target = Math.min(last, Math.max(0, rowIndexOf(pageNumber, options) + offset));
  return rowPages(target, pageCount, options)[0] ?? 1;
}

/**
 * Which side of the spine a page sits on: left pages are odd in a plain
 * spread and even after a cover, which itself sits on the right.
 */
export function sideOf(pageNumber: number, options: RowOptions): 'left' | 'right' | 'centre' {
  if (options.spread === 'none') return 'centre';
  const leftParity = hasCover(options) ? 0 : 1;
  return pageNumber % 2 === leftParity ? 'left' : 'right';
}
