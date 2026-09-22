import type { PdfPageGeometry } from '@pdf/render/types';

/** Gap between pages, in CSS pixels. */
export const PAGE_GAP = 16;
/** Padding around the page column. */
export const PAGE_MARGIN = 16;

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 10;

export type ZoomMode = 'fitPage' | 'fitWidth' | 'actual' | 'custom';

export interface PageBox {
  pageNumber: number;
  /** Offset of the page top within the scrollable content, in CSS pixels. */
  top: number;
  width: number;
  height: number;
}

export interface PageLayout {
  boxes: PageBox[];
  contentHeight: number;
  contentWidth: number;
}

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** Page size after the page's own rotation and the view rotation, at scale 1. */
export function rotatedSize(
  page: Pick<PdfPageGeometry, 'width' | 'height' | 'rotation'>,
  viewRotation: number,
): { width: number; height: number } {
  const turns = Math.round(((page.rotation + viewRotation) % 360) / 90);
  const swapped = Math.abs(turns) % 2 === 1;
  return swapped
    ? { width: page.height, height: page.width }
    : { width: page.width, height: page.height };
}

/**
 * Stacks the pages vertically. Every page keeps its own size, so documents
 * that mix portrait and landscape lay out correctly.
 */
export function layoutPages(
  pages: readonly PdfPageGeometry[],
  scale: number,
  viewRotation: number,
): PageLayout {
  const boxes: PageBox[] = [];
  let top = PAGE_MARGIN;
  let contentWidth = 0;

  for (const page of pages) {
    const size = rotatedSize(page, viewRotation);
    const width = Math.max(1, Math.round(size.width * scale));
    const height = Math.max(1, Math.round(size.height * scale));
    boxes.push({ pageNumber: page.pageNumber, top, width, height });
    contentWidth = Math.max(contentWidth, width);
    top += height + PAGE_GAP;
  }

  return {
    boxes,
    // The last gap becomes the bottom margin.
    contentHeight: pages.length === 0 ? 0 : top - PAGE_GAP + PAGE_MARGIN,
    contentWidth: contentWidth + PAGE_MARGIN * 2,
  };
}

/**
 * Pages to keep mounted: everything on screen plus an overscan band above and
 * below. This is what bounds memory — only these pages hold a canvas.
 */
export function visiblePages(
  layout: PageLayout,
  scrollTop: number,
  viewportHeight: number,
  overscan = viewportHeight,
): number[] {
  if (layout.boxes.length === 0 || viewportHeight <= 0) return [];
  const from = scrollTop - overscan;
  const to = scrollTop + viewportHeight + overscan;

  const visible: number[] = [];
  for (const box of layout.boxes) {
    const bottom = box.top + box.height;
    if (bottom < from) continue;
    if (box.top > to) break;
    visible.push(box.pageNumber);
  }
  return visible;
}

/** The page the status bar should report: the one covering the viewport top. */
export function currentPage(layout: PageLayout, scrollTop: number, viewportHeight: number): number {
  const first = layout.boxes[0];
  if (first === undefined) return 1;

  // A page counts as current once its top passes a quarter into the viewport.
  const anchor = scrollTop + Math.min(viewportHeight * 0.25, viewportHeight);
  let current = first.pageNumber;
  for (const box of layout.boxes) {
    if (box.top <= anchor) current = box.pageNumber;
    else break;
  }
  return current;
}

/** Scroll offset that puts a page at the top of the viewport. */
export function scrollTopForPage(layout: PageLayout, pageNumber: number): number {
  const box = layout.boxes.find((candidate) => candidate.pageNumber === pageNumber);
  return box === undefined ? 0 : Math.max(0, box.top - PAGE_MARGIN);
}

export interface FitOptions {
  page: Pick<PdfPageGeometry, 'width' | 'height' | 'rotation'>;
  viewportWidth: number;
  viewportHeight: number;
  viewRotation: number;
  /** Width taken by the scrollbar, so fit-width does not overflow. */
  scrollbarWidth?: number;
}

/** Scale for a fit mode, based on the page the user is looking at. */
export function scaleForMode(mode: ZoomMode, options: FitOptions, currentScale = 1): number {
  if (mode === 'actual') return 1;
  if (mode === 'custom') return clampScale(currentScale);

  const size = rotatedSize(options.page, options.viewRotation);
  const availableWidth = options.viewportWidth - PAGE_MARGIN * 2 - (options.scrollbarWidth ?? 0);
  if (mode === 'fitWidth') {
    return clampScale(availableWidth / size.width);
  }

  const availableHeight = options.viewportHeight - PAGE_MARGIN * 2;
  return clampScale(Math.min(availableWidth / size.width, availableHeight / size.height));
}

/** Zoom steps used by the zoom in/out commands, in percent. */
const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8];

export function nextZoomStep(scale: number, direction: 1 | -1): number {
  const steps = direction === 1 ? ZOOM_STEPS : [...ZOOM_STEPS].reverse();
  const next = steps.find((step) =>
    direction === 1 ? step > scale + 0.001 : step < scale - 0.001,
  );
  return clampScale(next ?? scale);
}
