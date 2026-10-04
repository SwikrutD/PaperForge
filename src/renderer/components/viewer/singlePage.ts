import { contentWidthOf, PAGE_MARGIN, type PageLayout } from './viewerLayout';

/**
 * How pages follow one another: one long scrolling column, or one page at a
 * time with the reader turning pages.
 */
export type PageMode = 'continuous' | 'single';

/**
 * The layout single-page view shows: only the given pages, moved up to the
 * top of the content. Every box is kept, so `boxes[pageNumber - 1]` still
 * finds any page, but the content is only as tall as the pages on show.
 */
export function isolatePages(layout: PageLayout, pageNumbers: readonly number[]): PageLayout {
  const shown = pageNumbers
    .map((pageNumber) => layout.boxes[pageNumber - 1])
    .filter((box) => box !== undefined);
  if (shown.length === 0) return layout;

  const top = Math.min(...shown.map((box) => box.top));
  const bottom = Math.max(...shown.map((box) => box.top + box.height));
  const shift = top - PAGE_MARGIN;

  return {
    boxes: layout.boxes.map((box) => ({ ...box, top: box.top - shift })),
    contentHeight: bottom - top + PAGE_MARGIN * 2,
    contentWidth: contentWidthOf(shown),
  };
}

/** Where a scroller stands relative to the ends of its content. */
export interface ScrollEdges {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}

/** A pixel of slack, because scroll positions are fractional at some zooms. */
const EDGE_SLACK = 1;

export function atBottom({ scrollTop, clientHeight, scrollHeight }: ScrollEdges): boolean {
  return scrollTop + clientHeight >= scrollHeight - EDGE_SLACK;
}

export function atTop({ scrollTop }: ScrollEdges): boolean {
  return scrollTop <= EDGE_SLACK;
}

/**
 * Wheel movement against an end of the page before the page turns. One notch
 * of a mouse wheel is about 100; a touchpad sends many small deltas, which
 * have to add up to the same before anything happens.
 */
export const WHEEL_TURN_THRESHOLD = 120;
/** After a turn, the rest of the same flick is ignored for this long. */
export const WHEEL_TURN_COOLDOWN_MS = 400;

export interface WheelTurnState {
  /** Wheel movement pushed against the edge so far, signed like `deltaY`. */
  pushed: number;
  /** When the page last turned, in milliseconds. */
  turnedAt: number;
}

export const INITIAL_WHEEL_TURN: WheelTurnState = { pushed: 0, turnedAt: -Infinity };

/**
 * Decides whether a wheel event turns the page in single-page view.
 *
 * The page turns only once the reader keeps scrolling against the end they
 * have already reached, so scrolling down a tall page stops at its foot before
 * moving on, and a touchpad's momentum does not race through the document.
 */
export function wheelTurn(
  state: WheelTurnState,
  deltaY: number,
  edges: ScrollEdges,
  now: number,
): { state: WheelTurnState; turn: 1 | -1 | 0 } {
  if (now - state.turnedAt < WHEEL_TURN_COOLDOWN_MS) {
    return { state: { ...state, turnedAt: now }, turn: 0 };
  }

  const pushingDown = deltaY > 0 && atBottom(edges);
  const pushingUp = deltaY < 0 && atTop(edges);
  if (!pushingDown && !pushingUp) return { state: { ...state, pushed: 0 }, turn: 0 };

  // A change of direction starts the count again.
  const pushed = Math.sign(state.pushed) === Math.sign(deltaY) ? state.pushed + deltaY : deltaY;
  if (Math.abs(pushed) < WHEEL_TURN_THRESHOLD) return { state: { ...state, pushed }, turn: 0 };
  return { state: { pushed: 0, turnedAt: now }, turn: pushed > 0 ? 1 : -1 };
}

/**
 * What a key does in single-page view, given where the page is scrolled.
 * Page Up and Page Down scroll a tall page first and turn it at its ends; the
 * arrow keys left and right turn it when there is nothing to scroll sideways;
 * Home and End go to the first and last page. Null leaves the key to the
 * browser.
 */
export function keyTurn(
  key: string,
  edges: ScrollEdges & { scrollWidth: number; clientWidth: number },
): 'next' | 'previous' | 'first' | 'last' | null {
  const noSideways = edges.scrollWidth <= edges.clientWidth + EDGE_SLACK;
  switch (key) {
    case 'PageDown':
      return atBottom(edges) ? 'next' : null;
    case 'PageUp':
      return atTop(edges) ? 'previous' : null;
    case 'ArrowRight':
      return noSideways ? 'next' : null;
    case 'ArrowLeft':
      return noSideways ? 'previous' : null;
    case 'Home':
      return 'first';
    case 'End':
      return 'last';
    default:
      return null;
  }
}
