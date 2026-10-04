import { clampScale, nextZoomStep, PAGE_MARGIN, type PageLayout } from './viewerLayout';

/** A rectangle in the scroller's content, in CSS pixels from its top-left. */
export interface ContentRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Below this size, in either direction, a drag counts as a click. */
export const MARQUEE_CLICK_SLOP = 6;

/** The rectangle between two corners, whichever way it was dragged. */
export function marqueeRect(
  from: { x: number; y: number },
  to: { x: number; y: number },
): ContentRect {
  return {
    left: Math.min(from.x, to.x),
    top: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  };
}

export function isClick(rect: ContentRect): boolean {
  return rect.width < MARQUEE_CLICK_SLOP && rect.height < MARQUEE_CLICK_SLOP;
}

/**
 * The scale that makes a dragged rectangle fill the window. A click zooms in
 * one step instead, or out one step with Shift held.
 */
export function marqueeScale(
  scale: number,
  rect: ContentRect,
  viewport: { width: number; height: number },
  zoomOut = false,
): number {
  if (isClick(rect)) return nextZoomStep(scale, zoomOut ? -1 : 1);
  const available = {
    width: Math.max(1, viewport.width - PAGE_MARGIN * 2),
    height: Math.max(1, viewport.height - PAGE_MARGIN * 2),
  };
  const factor = Math.min(available.width / rect.width, available.height / rect.height);
  return clampScale(scale * factor);
}

/**
 * A point tied to a page rather than to the content: which page, and how far
 * across and down it as fractions. It survives a change of zoom, which moves
 * every page.
 */
export interface PageAnchor {
  pageNumber: number;
  x: number;
  y: number;
}

/** Content width as laid out: the scroller's width, or the pages' if wider. */
function laidOutWidth(layout: PageLayout, clientWidth: number): number {
  return Math.max(clientWidth, layout.contentWidth);
}

/**
 * The page anchor for a point in the content. A point between pages anchors
 * to the nearest of the given pages, which keeps the zoom centred near it.
 */
export function anchorAt(
  layout: PageLayout,
  point: { x: number; y: number },
  clientWidth: number,
  candidates: readonly number[],
): PageAnchor | null {
  const centre = laidOutWidth(layout, clientWidth) / 2;
  let best: { anchor: PageAnchor; distance: number } | null = null;

  for (const pageNumber of candidates) {
    const box = layout.boxes[pageNumber - 1];
    if (box === undefined) continue;
    const left = centre + box.left;
    const dx = Math.max(left - point.x, 0, point.x - (left + box.width));
    const dy = Math.max(box.top - point.y, 0, point.y - (box.top + box.height));
    const distance = Math.hypot(dx, dy);
    if (best === null || distance < best.distance) {
      best = {
        anchor: {
          pageNumber,
          x: (point.x - left) / box.width,
          y: (point.y - box.top) / box.height,
        },
        distance,
      };
    }
  }
  return best?.anchor ?? null;
}

/** The scroll position that puts an anchored point in the middle of the window. */
export function scrollForAnchor(
  layout: PageLayout,
  anchor: PageAnchor,
  viewport: { width: number; height: number },
): { left: number; top: number } | null {
  const box = layout.boxes[anchor.pageNumber - 1];
  if (box === undefined) return null;
  const centre = laidOutWidth(layout, viewport.width) / 2;
  const x = centre + box.left + anchor.x * box.width;
  const y = box.top + anchor.y * box.height;
  return {
    left: Math.max(0, x - viewport.width / 2),
    top: Math.max(0, y - viewport.height / 2),
  };
}
