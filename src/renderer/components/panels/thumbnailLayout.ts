import type { PdfPageGeometry } from '@pdf/render/types';
import type { PageLayout } from '../viewer/viewerLayout';

/** Width of a thumbnail in the navigation panel, in CSS pixels. */
export const THUMBNAIL_WIDTH = 120;
/**
 * Height an entry adds to its thumbnail: padding and border around it, the gap
 * and the page label below. `PagesPanel.module.css` sizes the entry to match.
 */
export const THUMBNAIL_CHROME = 30;
/** Space between entries, and above the first and below the last. */
export const THUMBNAIL_GAP = 8;

/** The thumbnail's height for a page, keeping the page's proportions. */
export function thumbnailHeight(page: Pick<PdfPageGeometry, 'width' | 'height'>): number {
  const aspect = page.width === 0 ? 1.4 : page.height / page.width;
  return Math.round(THUMBNAIL_WIDTH * aspect);
}

/**
 * Where each entry of the thumbnail list sits. Every entry's height is known
 * from its page's proportions, so the list can be laid out without drawing it
 * and only the entries near the view need to exist — which is what keeps a
 * document of thousands of pages as quick to open as a short one.
 */
export function layoutThumbnails(pages: readonly PdfPageGeometry[]): PageLayout {
  let top = THUMBNAIL_GAP;
  const boxes = pages.map((page) => {
    const height = thumbnailHeight(page) + THUMBNAIL_CHROME;
    const box = {
      pageNumber: page.pageNumber,
      top,
      left: -THUMBNAIL_WIDTH / 2,
      width: THUMBNAIL_WIDTH,
      height,
    };
    top += height + THUMBNAIL_GAP;
    return box;
  });
  return { boxes, contentHeight: top, contentWidth: THUMBNAIL_WIDTH };
}

/** The scroll offset that brings an entry into view, or null when it already is. */
export function scrollToReveal(
  layout: PageLayout,
  pageNumber: number,
  scrollTop: number,
  viewportHeight: number,
): number | null {
  const box = layout.boxes[pageNumber - 1];
  if (box === undefined) return null;
  if (box.top >= scrollTop && box.top + box.height <= scrollTop + viewportHeight) return null;
  if (box.top < scrollTop) return Math.max(0, box.top - THUMBNAIL_GAP);
  return box.top + box.height + THUMBNAIL_GAP - viewportHeight;
}
