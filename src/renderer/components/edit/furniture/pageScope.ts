import { parsePageRange } from '@shared/utils/pageRange';

/** Which pages a change applies to: all of them, this one, or a range. */
export type PageScope = 'all' | 'current' | 'range';

/** The pages a scope names, or none when the range does not make sense. */
export function pagesForScope(
  scope: PageScope,
  rangeText: string,
  pageCount: number,
  currentPage: number,
): number[] {
  if (scope === 'all') return Array.from({ length: pageCount }, (_, index) => index + 1);
  if (scope === 'current') return [currentPage];

  const range = parsePageRange(rangeText, pageCount);
  return range.kind === 'pages' ? [...range.pages] : [];
}
