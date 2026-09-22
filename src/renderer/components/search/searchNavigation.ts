import type { SearchRect } from '@pdf/search/textSearch';
import type { SearchHit } from '../../stores/searchStore';

/**
 * The match to land on when a search finishes: the first one at or after the
 * page the reader is looking at, so searching does not throw them back to the
 * start of the document. Falls back to the first match anywhere.
 */
export function chooseInitialIndex(
  hits: readonly SearchHit[],
  sessionId: string | null,
  pageNumber: number,
): number {
  if (hits.length === 0) return -1;

  const ahead = hits.findIndex(
    (hit) => hit.sessionId === sessionId && hit.pageNumber >= pageNumber,
  );
  if (ahead >= 0) return ahead;

  const inDocument = hits.findIndex((hit) => hit.sessionId === sessionId);
  return inDocument >= 0 ? inDocument : 0;
}

/** Steps through the matches, wrapping around at either end. */
export function stepIndex(current: number, count: number, direction: 1 | -1): number {
  if (count === 0) return -1;
  if (current < 0) return direction === 1 ? 0 : count - 1;
  return (current + direction + count) % count;
}

export interface HighlightRect {
  id: string;
  rect: SearchRect;
  active: boolean;
}

/**
 * The rectangles to draw on each page of one document.
 *
 * With "highlight all" off only the current match is drawn, which is what a
 * reader who wants a clean page expects.
 */
export function highlightsByPage(
  hits: readonly SearchHit[],
  sessionId: string,
  currentIndex: number,
  highlightAll: boolean,
): Map<number, HighlightRect[]> {
  const byPage = new Map<number, HighlightRect[]>();
  const current = hits[currentIndex] ?? null;

  hits.forEach((hit, index) => {
    if (hit.sessionId !== sessionId) return;
    const active = index === currentIndex;
    if (!highlightAll && !active) return;

    const existing = byPage.get(hit.pageNumber) ?? [];
    hit.rects.forEach((rect, rectIndex) => {
      existing.push({ id: `${hit.id}:${rectIndex}`, rect, active });
    });
    byPage.set(hit.pageNumber, existing);
  });

  // The current match is drawn last so it sits over any overlapping match.
  if (current !== null && current.sessionId === sessionId) {
    const page = byPage.get(current.pageNumber);
    if (page !== undefined) {
      page.sort((left, right) => Number(left.active) - Number(right.active));
    }
  }
  return byPage;
}
