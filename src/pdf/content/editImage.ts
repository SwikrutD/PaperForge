import { spliceBytes } from './editText';
import { appendIsolated } from './appendContent';
import type { ImagePlacement } from './images';
import { invert, multiply, type Matrix } from './state';
import { formatNumber } from './values';

/**
 * Changing where an image sits, what it shows, and whether it is there at all.
 *
 * Every change is made where the image is drawn, not appended to the end of
 * the page: an image that moves must keep its place in the order things are
 * drawn, or it would jump in front of whatever used to cover it.
 *
 * The trick that makes that possible is undoing the transform already in
 * force. The `Do` becomes `q <M> cm /Name Do Q`, where `M` cancels the page's
 * own transform and applies the one the reader asked for, so the result does
 * not depend on how the page got there.
 */

export interface ImageEdit {
  /** Where the image should end up, as a transform of the unit square. */
  matrix: Matrix;
  /**
   * The part of the image to show, in its own coordinates where the whole
   * image is the unit square. Null shows all of it.
   */
  crop?: { x: number; y: number; width: number; height: number } | null;
  /** A different image to draw in its place, by resource name. */
  resourceName?: string;
  /** The transparency state to draw with, by resource name. */
  alphaName?: string;
}

/** Writes a matrix the way a content stream spells one. */
export function formatMatrix(matrix: Matrix): string {
  return [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f]
    .map((value) => formatNumber(round(value)))
    .join(' ');
}

/**
 * Draws an image somewhere else, in place.
 *
 * Returns null when the transform in force cannot be undone — a page that has
 * flattened its content onto a line, which nothing can move sensibly.
 */
export function moveImage(
  content: Uint8Array,
  placement: ImagePlacement,
  edit: ImageEdit,
): Uint8Array | null {
  const undo = invert(placement.matrix);
  if (undo === null) return null;

  // Apply the transform the reader asked for, then undo the page's own, so
  // that what is left inside the q/Q is exactly the new placement.
  const local = multiply(edit.matrix, undo);
  const name = edit.resourceName ?? placement.resourceName;
  const clip = edit.crop == null ? '' : `${cropRect(edit.crop)} `;
  const alpha = edit.alphaName === undefined ? '' : `/${edit.alphaName} gs `;

  return spliceBytes(
    content,
    placement.operationRange,
    `q ${alpha}${formatMatrix(local)} cm ${clip}/${name} Do Q`,
  );
}

/** The clip a crop needs, in the image's own square. */
function cropRect(crop: { x: number; y: number; width: number; height: number }): string {
  const x = clampUnit(crop.x);
  const y = clampUnit(crop.y);
  const width = Math.max(0.001, Math.min(crop.width, 1 - x));
  const height = Math.max(0.001, Math.min(crop.height, 1 - y));
  return `${formatNumber(round(x))} ${formatNumber(round(y))} ${formatNumber(
    round(width),
  )} ${formatNumber(round(height))} re W n`;
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Takes an image off the page, leaving everything else as it was. */
export function removeImage(content: Uint8Array, placement: ImagePlacement): Uint8Array {
  return spliceBytes(content, placement.operationRange, '');
}

/**
 * Draws an image on a page, over whatever is already there, from the page's
 * initial state — so it lands where it was asked for whatever transform, clip
 * or transparency the page's own drawing leaves in force.
 */
export function appendImage(
  content: Uint8Array,
  matrix: Matrix,
  resourceName: string,
  alphaName?: string,
): Uint8Array {
  const alpha = alphaName === undefined ? '' : `/${alphaName} gs `;
  return appendIsolated(content, `\nq ${alpha}${formatMatrix(matrix)} cm /${resourceName} Do Q\n`);
}

/** Six decimal places is more than a page needs, and keeps the file small. */
function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
