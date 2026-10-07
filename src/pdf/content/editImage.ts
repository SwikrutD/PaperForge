import { spliceBytes } from './editText';
import { appendIsolated } from './appendContent';
import type { ImagePlacement } from './images';
import { ADDED_IMAGE_ID, IMAGE_TAG } from './imageGroups';
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
 *
 * When the picture has a `q … Q` of its own — its transform, its clip, its
 * transparency and nothing else — that whole group is what is drawn again, so
 * the clip goes with the picture and changes never nest inside one another.
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
  const { group } = placement;
  // The group starts from the transform in force at its `q`; a bare `Do`
  // from the one in force where it is.
  const undo = invert(group === null ? placement.matrix : group.ctm);
  if (undo === null) return null;

  // Apply the transform the reader asked for, then undo the page's own, so
  // that what is left inside the q/Q is exactly the new placement.
  const local = multiply(edit.matrix, undo);
  const draw = drawingOf(content, placement, edit.resourceName);
  const clip = edit.crop == null ? '' : `${cropRect(edit.crop)} `;
  // The document's own graphics states may do more than fade — a blend mode,
  // a soft mask — so they are kept. PaperForge's own are replaced.
  const kept = (group?.states ?? [])
    .filter((state) => !state.startsWith(ALPHA_PREFIX))
    .map((state) => `/${state} gs `)
    .join('');
  const alpha = edit.alphaName === undefined ? '' : `/${edit.alphaName} gs `;

  return spliceBytes(
    content,
    group?.range ?? placement.operationRange,
    `q ${kept}${alpha}${formatMatrix(local)} cm ${clip}${draw} Q`,
  );
}

/**
 * The operation that paints the picture: `/Name Do`, or for an inline image
 * its own `BI … EI`, carried byte for byte. A replacement is always a named
 * resource, so an inline picture replaced becomes an ordinary one.
 */
function drawingOf(
  content: Uint8Array,
  placement: ImagePlacement,
  replacement: string | undefined,
): string {
  if (replacement !== undefined || placement.kind !== 'inline') {
    return `/${replacement ?? placement.resourceName} Do`;
  }
  // Latin-1 maps every byte to one character and back, so the samples
  // survive `spliceBytes` untouched.
  const { start, end } = placement.operationRange;
  let text = '';
  for (let offset = start; offset < end; offset += 8192) {
    text += String.fromCharCode(...content.subarray(offset, Math.min(end, offset + 8192)));
  }
  return text;
}

/** Names a transparency state PaperForge added; see `imageResources.ts`. */
const ALPHA_PREFIX = 'PFAlpha';

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

/**
 * Takes an image off the page, leaving everything else as it was: with its
 * marking when PaperForge added it, with its group when it has one.
 */
export function removeImage(content: Uint8Array, placement: ImagePlacement): Uint8Array {
  const range = placement.mark?.range ?? placement.group?.range ?? placement.operationRange;
  return spliceBytes(content, range, '');
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
  alphaName: string | undefined,
  imageId: string,
): Uint8Array {
  // The id is written into the stream, so only the shape PaperForge gives out
  // is accepted: nothing in it can end the string early.
  if (!ADDED_IMAGE_ID.test(imageId)) throw new Error(`not an image id: ${imageId}`);
  const alpha = alphaName === undefined ? '' : `/${alphaName} gs `;
  return appendIsolated(
    content,
    `\n/${IMAGE_TAG} << /PFId (${imageId}) >> BDC\nq ${alpha}${formatMatrix(
      matrix,
    )} cm /${resourceName} Do Q\nEMC\n`,
  );
}

/** Six decimal places is more than a page needs, and keeps the file small. */
function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
