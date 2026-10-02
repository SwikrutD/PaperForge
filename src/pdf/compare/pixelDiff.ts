/**
 * Where two pictures of a page differ.
 *
 * Both pages are drawn at the same scale onto canvases of the same size; a
 * pixel differs when its colour moved by more than anti-aliasing would move
 * it. Differing pixels are gathered into cells and neighbouring cells into
 * regions, so the reader is shown a handful of boxes rather than ten thousand
 * dots. This runs in a worker: it is arithmetic on every pixel of two pages.
 */

export interface PixelRegion {
  /** In canvas pixels from the top-left. */
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PixelDiffInput {
  width: number;
  height: number;
  /** RGBA, as a canvas gives it. */
  original: Uint8ClampedArray;
  revised: Uint8ClampedArray;
  /** Also paint a picture of the difference. */
  overlay: boolean;
}

export interface PixelDiffResult {
  regions: PixelRegion[];
  /** Share of all pixels that differ. */
  changedRatio: number;
  /** RGBA picture of the difference, when one was asked for. */
  overlay: Uint8ClampedArray | null;
}

/** Summed RGB distance below which two pixels are the same: anti-aliasing noise. */
const PIXEL_THRESHOLD = 96;
/** Pixels per cell side. */
const CELL = 8;
/** A cell counts when this many of its pixels differ. */
const CELL_MINIMUM = 3;
/** Regions closer than this many cells are one region. */
const MERGE_GAP = 2;
/** More regions than this on one page are summarised as one. */
const MAX_REGIONS = 200;

export function diffPixels(input: PixelDiffInput): PixelDiffResult {
  const { width, height, original, revised } = input;
  const columns = Math.ceil(width / CELL);
  const rows = Math.ceil(height / CELL);
  const cells = new Uint16Array(columns * rows);
  const overlay = input.overlay ? new Uint8ClampedArray(width * height * 4) : null;
  let changed = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      const before = luminanceAndDistance(original, revised, at);
      const different = before.distance > PIXEL_THRESHOLD;
      if (different) {
        changed += 1;
        const cell = Math.floor(y / CELL) * columns + Math.floor(x / CELL);
        cells[cell] = (cells[cell] ?? 0) + 1;
      }
      if (overlay !== null) paint(overlay, at, different, before.original, before.revised);
    }
  }

  const flagged = new Uint8Array(columns * rows);
  for (let index = 0; index < cells.length; index += 1) {
    if ((cells[index] ?? 0) >= CELL_MINIMUM) flagged[index] = 1;
  }

  let regions = groupCells(flagged, columns, rows).map((group) => ({
    left: group.left * CELL,
    top: group.top * CELL,
    width: Math.min(width, (group.right + 1) * CELL) - group.left * CELL,
    height: Math.min(height, (group.bottom + 1) * CELL) - group.top * CELL,
  }));
  if (regions.length > MAX_REGIONS) regions = [bounding(regions)];

  return {
    regions,
    changedRatio: width * height === 0 ? 0 : changed / (width * height),
    overlay,
  };
}

function luminanceAndDistance(
  original: Uint8ClampedArray,
  revised: Uint8ClampedArray,
  at: number,
): { distance: number; original: number; revised: number } {
  const r1 = original[at] ?? 255;
  const g1 = original[at + 1] ?? 255;
  const b1 = original[at + 2] ?? 255;
  const r2 = revised[at] ?? 255;
  const g2 = revised[at + 1] ?? 255;
  const b2 = revised[at + 2] ?? 255;
  return {
    distance: Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2),
    original: 0.299 * r1 + 0.587 * g1 + 0.114 * b1,
    revised: 0.299 * r2 + 0.587 * g2 + 0.114 * b2,
  };
}

/**
 * The difference picture: what is the same is shown faint, ink only the
 * original has is red, ink only the revision has is blue, and a pixel that
 * changed colour while staying inked is amber. Colour alone is not the only
 * cue — the regions are outlined in the view as well.
 */
function paint(
  overlay: Uint8ClampedArray,
  at: number,
  different: boolean,
  before: number,
  after: number,
): void {
  if (!different) {
    const faint = 255 - (255 - Math.min(before, after)) * 0.25;
    overlay[at] = faint;
    overlay[at + 1] = faint;
    overlay[at + 2] = faint;
  } else if (after > before + 40) {
    overlay[at] = 210;
    overlay[at + 1] = 40;
    overlay[at + 2] = 40;
  } else if (before > after + 40) {
    overlay[at] = 30;
    overlay[at + 1] = 100;
    overlay[at + 2] = 220;
  } else {
    overlay[at] = 230;
    overlay[at + 1] = 150;
    overlay[at + 2] = 20;
  }
  overlay[at + 3] = 255;
}

interface CellGroup {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Connected flagged cells, with gaps of up to `MERGE_GAP` cells bridged. */
function groupCells(flagged: Uint8Array, columns: number, rows: number): CellGroup[] {
  const seen = new Uint8Array(flagged.length);
  const groups: CellGroup[] = [];

  for (let start = 0; start < flagged.length; start += 1) {
    if (flagged[start] !== 1 || seen[start] === 1) continue;
    const group: CellGroup = {
      left: start % columns,
      right: start % columns,
      top: Math.floor(start / columns),
      bottom: Math.floor(start / columns),
    };
    const stack = [start];
    seen[start] = 1;

    while (stack.length > 0) {
      const cell = stack.pop() as number;
      const column = cell % columns;
      const row = Math.floor(cell / columns);
      group.left = Math.min(group.left, column);
      group.right = Math.max(group.right, column);
      group.top = Math.min(group.top, row);
      group.bottom = Math.max(group.bottom, row);

      for (let dy = -MERGE_GAP; dy <= MERGE_GAP; dy += 1) {
        for (let dx = -MERGE_GAP; dx <= MERGE_GAP; dx += 1) {
          const nextColumn = column + dx;
          const nextRow = row + dy;
          if (nextColumn < 0 || nextRow < 0 || nextColumn >= columns || nextRow >= rows) continue;
          const next = nextRow * columns + nextColumn;
          if (flagged[next] !== 1 || seen[next] === 1) continue;
          seen[next] = 1;
          stack.push(next);
        }
      }
    }
    groups.push(group);
  }
  return groups;
}

function bounding(regions: readonly PixelRegion[]): PixelRegion {
  const left = Math.min(...regions.map((region) => region.left));
  const top = Math.min(...regions.map((region) => region.top));
  const right = Math.max(...regions.map((region) => region.left + region.width));
  const bottom = Math.max(...regions.map((region) => region.top + region.height));
  return { left, top, width: right - left, height: bottom - top };
}
