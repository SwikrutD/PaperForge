import type { PageBoxes, PageBoxRect } from '../schemas/pages';

/**
 * Crop arithmetic shared by the page grid and the crop tool on the page.
 *
 * A crop is expressed as margins: how far each edge moves in from what the
 * page shows now. One rectangle cannot crop pages of different sizes
 * sensibly; margins can.
 */

/** How far in each edge moves, in points. */
export interface CropMargins {
  left: number;
  bottom: number;
  right: number;
  top: number;
}

export const ZERO_MARGINS: CropMargins = { left: 0, bottom: 0, right: 0, top: 0 };

export interface CropOperation {
  kind: 'cropPages';
  pages: number[];
  box: PageBoxRect;
  target: 'crop' | 'media';
}

/** What a page shows: its crop box where it has one, inside its media box. */
export function visibleBox(entry: PageBoxes): PageBoxRect {
  const media = entry.media;
  const crop = entry.crop;
  if (crop === null) return media;

  const x = Math.max(media.x, crop.x);
  const y = Math.max(media.y, crop.y);
  const right = Math.min(media.x + media.width, crop.x + crop.width);
  const top = Math.min(media.y + media.height, crop.y + crop.height);
  // A crop box wholly outside the page is ignored by every reader.
  if (right <= x || top <= y) return media;
  return { x, y, width: right - x, height: top - y };
}

/**
 * Crop operations for the chosen pages.
 *
 * Margins are relative to the box named by `from`, so pages of different
 * sizes end up with the same margins rather than the same rectangle. Pages
 * that would end up with the same rectangle share one operation.
 */
export function cropOperations(
  boxes: readonly PageBoxes[],
  pages: readonly number[],
  margins: CropMargins,
  target: 'crop' | 'media',
  from: 'crop' | 'media',
): CropOperation[] {
  const grouped = new Map<string, { box: PageBoxRect; pages: number[] }>();

  for (const pageNumber of pages) {
    const entry = boxes.find((candidate) => candidate.pageNumber === pageNumber);
    if (entry === undefined) continue;

    const source = from === 'media' ? entry.media : visibleBox(entry);
    const box: PageBoxRect = {
      x: source.x + margins.left,
      y: source.y + margins.bottom,
      width: Math.max(1, source.width - margins.left - margins.right),
      height: Math.max(1, source.height - margins.bottom - margins.top),
    };

    const key = `${box.x}:${box.y}:${box.width}:${box.height}`;
    const existing = grouped.get(key);
    if (existing === undefined) grouped.set(key, { box, pages: [pageNumber] });
    else existing.pages.push(pageNumber);
  }

  return [...grouped.values()].map((group) => ({
    kind: 'cropPages' as const,
    pages: group.pages,
    box: group.box,
    target,
  }));
}

/**
 * The margins a frame drawn on a page leaves, measured from what the page
 * shows. Whatever part of the frame lies outside the page is ignored.
 */
export function marginsOf(frame: PageBoxRect, visible: PageBoxRect): CropMargins {
  const round = (value: number): number => Math.max(0, Math.round(value * 100) / 100);
  const left = round(frame.x - visible.x);
  const bottom = round(frame.y - visible.y);
  const right = round(visible.x + visible.width - (frame.x + frame.width));
  const top = round(visible.y + visible.height - (frame.y + frame.height));
  return { left, bottom, right, top };
}

/** The frame that margins leave on a page — the inverse of `marginsOf`. */
export function frameOf(visible: PageBoxRect, margins: CropMargins): PageBoxRect {
  return {
    x: visible.x + margins.left,
    y: visible.y + margins.bottom,
    width: Math.max(1, visible.width - margins.left - margins.right),
    height: Math.max(1, visible.height - margins.bottom - margins.top),
  };
}

/** True when margins would leave at least a point of the page in each direction. */
export function marginsFit(visible: PageBoxRect, margins: CropMargins): boolean {
  return (
    margins.left + margins.right < visible.width - 1 &&
    margins.bottom + margins.top < visible.height - 1
  );
}

/** Which part of a frame is being dragged: the whole of it, or an edge or corner. */
export type FrameHandle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export interface ScreenBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * A frame on the screen after one of its handles has moved by `dx`, `dy`.
 *
 * The result stays inside `bounds` and never shrinks below `minimum` in
 * either direction; moving keeps the size and slides against the edges.
 */
export function adjustFrame(
  box: ScreenBox,
  handle: FrameHandle,
  dx: number,
  dy: number,
  bounds: { width: number; height: number },
  minimum = 8,
): ScreenBox {
  if (handle === 'move') {
    return {
      left: clamp(box.left + dx, 0, Math.max(0, bounds.width - box.width)),
      top: clamp(box.top + dy, 0, Math.max(0, bounds.height - box.height)),
      width: box.width,
      height: box.height,
    };
  }

  let left = box.left;
  let top = box.top;
  let right = box.left + box.width;
  let bottom = box.top + box.height;

  if (handle.includes('w')) left = clamp(left + dx, 0, right - minimum);
  if (handle.includes('e')) right = clamp(right + dx, left + minimum, bounds.width);
  if (handle.includes('n')) top = clamp(top + dy, 0, bottom - minimum);
  if (handle.includes('s')) bottom = clamp(bottom + dy, top + minimum, bounds.height);

  return { left, top, width: right - left, height: bottom - top };
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}
