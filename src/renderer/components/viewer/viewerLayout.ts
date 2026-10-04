import type { PdfPageGeometry } from '@pdf/render/types';
import { rowIndexOf, sideOf, type RowOptions } from './pageRows';

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
  /**
   * Offset of the page's left edge from the centre line of the content. A
   * page in a column straddles the line; in a spread the two pages meet at it.
   */
  left: number;
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

/**
 * Page size as displayed, at scale 1.
 *
 * `width` and `height` already carry the page's own rotation, so only the
 * reader's view rotation can turn the page onto its side.
 */
export function rotatedSize(
  page: Pick<PdfPageGeometry, 'width' | 'height'>,
  viewRotation: number,
): { width: number; height: number } {
  const swapped = Math.abs(Math.round(viewRotation / 90)) % 2 === 1;
  return swapped
    ? { width: page.height, height: page.width }
    : { width: page.width, height: page.height };
}

/** Where a page sits across the content, relative to the centre line. */
function leftOf(pageNumber: number, width: number, options: RowOptions): number {
  switch (sideOf(pageNumber, options)) {
    case 'left':
      return -PAGE_GAP / 2 - width;
    case 'right':
      return PAGE_GAP / 2;
    default:
      return -width / 2;
  }
}

/**
 * Content width that keeps every given page on screen. Pages are placed about
 * the centre line, so the content has to reach as far on both sides of it.
 */
export function contentWidthOf(boxes: readonly PageBox[]): number {
  let reach = 0;
  for (const box of boxes) reach = Math.max(reach, -box.left, box.left + box.width);
  return Math.ceil(reach * 2) + PAGE_MARGIN * 2;
}

/**
 * Stacks the pages vertically, a row at a time: one page to a row in a
 * column, two in a spread, meeting at the centre line like an open book.
 * Every page keeps its own size, so documents that mix portrait and landscape
 * lay out correctly; a row is as tall as its tallest page.
 */
export function layoutPages(
  pages: readonly PdfPageGeometry[],
  scale: number,
  viewRotation: number,
  options: RowOptions = { spread: 'none' },
): PageLayout {
  const boxes: PageBox[] = [];
  let top = PAGE_MARGIN;
  let rowHeight = 0;
  let row = -1;

  for (const page of pages) {
    const pageRow = rowIndexOf(page.pageNumber, options);
    if (pageRow !== row) {
      if (row >= 0) top += rowHeight + PAGE_GAP;
      row = pageRow;
      rowHeight = 0;
    }
    const size = rotatedSize(page, viewRotation);
    const width = Math.max(1, Math.round(size.width * scale));
    const height = Math.max(1, Math.round(size.height * scale));
    boxes.push({
      pageNumber: page.pageNumber,
      top,
      left: leftOf(page.pageNumber, width, options),
      width,
      height,
    });
    rowHeight = Math.max(rowHeight, height);
  }

  return {
    boxes,
    contentHeight: pages.length === 0 ? 0 : top + rowHeight + PAGE_MARGIN,
    contentWidth: contentWidthOf(boxes),
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
  // In a spread the row is current, and it is reported by its first page.
  const anchor = scrollTop + Math.min(viewportHeight * 0.25, viewportHeight);
  let current = first.pageNumber;
  let currentTop = first.top;
  for (const box of layout.boxes) {
    if (box.top > anchor) break;
    if (box.top !== currentTop) {
      current = box.pageNumber;
      currentTop = box.top;
    }
  }
  return current;
}

/** Scroll offset that puts a page at the top of the viewport. */
export function scrollTopForPage(layout: PageLayout, pageNumber: number): number {
  const box = layout.boxes.find((candidate) => candidate.pageNumber === pageNumber);
  return box === undefined ? 0 : Math.max(0, box.top - PAGE_MARGIN);
}

export interface FitOptions {
  /** The page being read; fit page is about this one. */
  page: Pick<PdfPageGeometry, 'width' | 'height'>;
  /**
   * The widest page in the document. Fit width uses it so that no page in the
   * column overflows sideways, which is what makes the mode predictable in a
   * document that mixes portrait and landscape.
   */
  widestPage?: Pick<PdfPageGeometry, 'width' | 'height'> | undefined;
  viewportWidth: number;
  viewportHeight: number;
  viewRotation: number;
  /** Width taken by the scrollbar, so fit-width does not overflow. */
  scrollbarWidth?: number;
  /** Pages side by side: two in a spread, each fitted to its half. */
  columns?: 1 | 2;
}

/** Scale for a fit mode, based on the page the user is looking at. */
/** Jumps further than this many screens go straight there instead of gliding. */
export const SMOOTH_JUMP_SCREENS = 2;

/**
 * How a jump should scroll. A short one glides, so the reader sees where they
 * went; a long one goes straight there, because gliding past hundreds of pages
 * would start and cancel a render for every one of them. Reduced motion never
 * glides.
 */
export function scrollBehaviorFor(
  distance: number,
  viewportHeight: number,
  reducedMotion: boolean,
): ScrollBehavior {
  if (reducedMotion) return 'auto';
  return Math.abs(distance) <= viewportHeight * SMOOTH_JUMP_SCREENS ? 'smooth' : 'auto';
}

/** True when Windows (or the browser) asks for less animation. */
export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

export function scaleForMode(mode: ZoomMode, options: FitOptions, currentScale = 1): number {
  if (mode === 'actual') return 1;
  if (mode === 'custom') return clampScale(currentScale);

  const size = rotatedSize(options.page, options.viewRotation);
  const columns = options.columns ?? 1;
  const availableWidth =
    (options.viewportWidth -
      PAGE_MARGIN * 2 -
      (options.scrollbarWidth ?? 0) -
      PAGE_GAP * (columns - 1)) /
    columns;
  if (mode === 'fitWidth') {
    const widest = rotatedSize(options.widestPage ?? options.page, options.viewRotation);
    return clampScale(availableWidth / widest.width);
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
