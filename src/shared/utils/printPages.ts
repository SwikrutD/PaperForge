import type { PrintSubset } from '../schemas/print';
import { parsePageRange } from './pageRange';

export type PrintScope = 'all' | 'current' | 'range';

export interface PrintPageChoice {
  scope: PrintScope;
  /** The range as typed, read only when the scope is a range. */
  rangeText: string;
  subset: PrintSubset;
  currentPage: number;
  pageCount: number;
}

export type PrintPageSelection =
  { kind: 'pages'; pages: number[] } | { kind: 'invalid'; message: string };

/**
 * The pages a print job sends, in order.
 *
 * Odd and even mean the pages' own numbers, as on a printed book: "even
 * pages" of 3-8 is 4, 6 and 8.
 */
export function selectPrintPages(choice: PrintPageChoice): PrintPageSelection {
  const { scope, subset, pageCount } = choice;
  if (pageCount <= 0) return { kind: 'invalid', message: 'The document has no pages.' };

  let pages: number[];
  if (scope === 'current') {
    pages = [Math.min(Math.max(1, choice.currentPage), pageCount)];
  } else if (scope === 'range') {
    if (choice.rangeText.trim() === '') {
      return { kind: 'invalid', message: 'Enter the pages to print, such as 1-4, 9.' };
    }
    const range = parsePageRange(choice.rangeText, pageCount);
    if (range.kind === 'invalid') return { kind: 'invalid', message: range.message };
    pages = range.kind === 'pages' ? range.pages : allPages(pageCount);
  } else {
    pages = allPages(pageCount);
  }

  if (subset !== 'all') {
    const wanted = subset === 'odd' ? 1 : 0;
    pages = pages.filter((page) => page % 2 === wanted);
    if (pages.length === 0) {
      return { kind: 'invalid', message: `Those pages include no ${subset} pages.` };
    }
  }

  return { kind: 'pages', pages };
}

function allPages(pageCount: number): number[] {
  return Array.from({ length: pageCount }, (_, index) => index + 1);
}
