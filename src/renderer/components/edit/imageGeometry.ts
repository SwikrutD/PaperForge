import type { ImagePlacementInput } from '@shared/schemas/edit';

/**
 * Dragging an image about, in the image's own axes.
 *
 * A placement is a box with a turn: the box is measured in PDF user space, and
 * the image is turned about the box's middle. Resizing therefore happens along
 * the image's own edges, not the page's — dragging the corner of a picture
 * that sits at an angle makes it longer along its own length.
 *
 * The corner the reader is not holding stays exactly where it is, which is
 * what makes dragging a handle feel like dragging that handle.
 */

/** Where a handle sits on the box, as a fraction of its width and height. */
export type HandleAnchor = 0 | 0.5 | 1;

export interface Handle {
  x: HandleAnchor;
  y: HandleAnchor;
}

/** The smallest an image may be dragged to, in PDF units. */
const MINIMUM = 4;

export function movedBy(
  placement: ImagePlacementInput,
  dx: number,
  dy: number,
): ImagePlacementInput {
  return { ...placement, x: placement.x + dx, y: placement.y + dy };
}

/** Turns an image by a number of degrees, about the middle of its box. */
export function turnedBy(placement: ImagePlacementInput, degrees: number): ImagePlacementInput {
  return { ...placement, rotation: (((placement.rotation + degrees) % 360) + 360) % 360 };
}

/**
 * Resizes an image by dragging one of its handles.
 *
 * `dx`/`dy` are in PDF user space; they are turned into the image's own axes
 * before they change anything, so the maths is the same whatever angle the
 * image sits at.
 */
export function resizedBy(
  placement: ImagePlacementInput,
  handle: Handle,
  dx: number,
  dy: number,
  keepAspect = false,
): ImagePlacementInput {
  const radians = (placement.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  // Into the image's own axes: the inverse of the turn, which for a rotation
  // is the turn the other way.
  const local = { x: dx * cos + dy * sin, y: -dx * sin + dy * cos };

  // A handle in the middle of an edge only changes the one dimension.
  const signX = handle.x === 0.5 ? 0 : handle.x === 1 ? 1 : -1;
  const signY = handle.y === 0.5 ? 0 : handle.y === 1 ? 1 : -1;

  let width = Math.max(MINIMUM, placement.width + signX * local.x);
  let height = Math.max(MINIMUM, placement.height + signY * local.y);

  if (keepAspect && signX !== 0 && signY !== 0) {
    // The larger change wins, so the picture keeps its shape.
    const ratio = placement.height / placement.width;
    if (Math.abs(width - placement.width) * ratio > Math.abs(height - placement.height)) {
      height = Math.max(MINIMUM, width * ratio);
    } else {
      width = Math.max(MINIMUM, height / ratio);
    }
  }

  // The handle opposite the one being dragged is the point that must not move.
  const fixed = { x: 1 - handle.x, y: 1 - handle.y };
  const anchor = pointAt(placement, fixed);
  const resized = { ...placement, width, height };
  const moved = pointAt(resized, fixed);

  return { ...resized, x: resized.x + (anchor.x - moved.x), y: resized.y + (anchor.y - moved.y) };
}

/**
 * The resize a handle makes: a corner keeps the picture's shape unless Shift
 * is held, and an edge only ever changes the one dimension it faces.
 */
export function resizeGesture(
  placement: ImagePlacementInput,
  handle: Handle,
  dx: number,
  dy: number,
  shift: boolean,
): ImagePlacementInput {
  const corner = handle.x !== 0.5 && handle.y !== 0.5;
  return resizedBy(placement, handle, dx, dy, corner && !shift);
}

/** How far Shift snaps a turn, in degrees. */
export const ROTATION_SNAP = 15;

/**
 * Turns an image by the angle the pointer has swung through about its middle,
 * from where the drag began. Shift snaps the result to whole steps of
 * {@link ROTATION_SNAP}. Angles are anticlockwise, as the placement keeps them.
 */
export function rotatedTo(
  placement: ImagePlacementInput,
  from: { x: number; y: number },
  to: { x: number; y: number },
  snap: boolean,
): ImagePlacementInput {
  const centre = pointAt(placement, { x: 0.5, y: 0.5 });
  const swing =
    Math.atan2(to.y - centre.y, to.x - centre.x) - Math.atan2(from.y - centre.y, from.x - centre.x);
  let rotation = normalizeDegrees(placement.rotation + (swing * 180) / Math.PI);
  if (snap) rotation = normalizeDegrees(Math.round(rotation / ROTATION_SNAP) * ROTATION_SNAP);
  return { ...placement, rotation };
}

function normalizeDegrees(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

/** The part of an image that shows, where the whole image is the unit square. */
export interface ImageCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The smallest a crop may be dragged to, as a share of the picture. */
const MINIMUM_CROP = 0.02;

/**
 * Drags a crop handle, or the whole crop when `handle` is null.
 *
 * Handles sit on the image's box as the reader sees it; the crop is in the
 * image's own square. The drag is turned into the image's axes and units, and
 * a mirrored image swaps which side the box's left edge is.
 */
export function cropDraggedBy(
  placement: ImagePlacementInput,
  crop: ImageCrop,
  handle: Handle | null,
  dx: number,
  dy: number,
): ImageCrop {
  const radians = (placement.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const mirror = placement.flipX ? -1 : 1;
  const du = (mirror * (dx * cos + dy * sin)) / placement.width;
  const dv = (-dx * sin + dy * cos) / placement.height;

  let left = crop.x;
  let right = crop.x + crop.width;
  let bottom = crop.y;
  let top = crop.y + crop.height;

  if (handle === null) {
    const shiftX = Math.max(-left, Math.min(1 - right, du));
    const shiftY = Math.max(-bottom, Math.min(1 - top, dv));
    return { x: left + shiftX, y: bottom + shiftY, width: crop.width, height: crop.height };
  }

  // Which of the image's own edges the handle is on.
  const edgeX = handle.x === 0.5 ? 0.5 : placement.flipX ? 1 - handle.x : handle.x;
  if (edgeX === 0) left = Math.max(0, Math.min(right - MINIMUM_CROP, left + du));
  if (edgeX === 1) right = Math.min(1, Math.max(left + MINIMUM_CROP, right + du));
  if (handle.y === 0) bottom = Math.max(0, Math.min(top - MINIMUM_CROP, bottom + dv));
  if (handle.y === 1) top = Math.min(1, Math.max(bottom + MINIMUM_CROP, top + dv));

  return { x: left, y: bottom, width: right - left, height: top - bottom };
}

/**
 * The box a picture cut down to its crop is drawn in: the part of the old box
 * that showed, turned and mirrored as the picture was.
 */
export function placementOfCrop(
  placement: ImagePlacementInput,
  crop: ImageCrop,
): ImagePlacementInput {
  const middle = crop.x + crop.width / 2;
  const centre = pointAt(placement, {
    x: placement.flipX ? 1 - middle : middle,
    y: crop.y + crop.height / 2,
  });
  const width = placement.width * crop.width;
  const height = placement.height * crop.height;
  return { ...placement, x: centre.x - width / 2, y: centre.y - height / 2, width, height };
}

/** How far an arrow key moves an image, in PDF units; Shift moves further. */
const NUDGE = 1;
const NUDGE_FAR = 10;

const ARROWS: Readonly<Record<string, { x: number; y: number }>> = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
};

/**
 * Which way an arrow key moves an image on the page: the way the arrow points
 * on screen, whatever way the page is turned. `rotation` is how far the page
 * is turned clockwise on screen, its own turn and the view's together.
 */
export function nudgeFor(
  key: string,
  shift: boolean,
  rotation: number,
): { dx: number; dy: number } | null {
  const arrow = ARROWS[key];
  if (arrow === undefined) return null;
  const step = shift ? NUDGE_FAR : NUDGE;
  const radians = (rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  // Undo the page's turn on screen, then flip y: the screen counts it down.
  const x = arrow.x * cos + arrow.y * sin;
  const y = -arrow.x * sin + arrow.y * cos;
  return { dx: clean(x * step), dy: clean(-y * step) };
}

/** Rounds away the dust a quarter turn leaves, so -0 and 1e-16 read as 0. */
function clean(value: number): number {
  const rounded = Math.round(value * 1e9) / 1e9;
  return rounded === 0 ? 0 : rounded;
}

/**
 * Where a point of the box lands in PDF user space, given as fractions of the
 * box's width and height.
 */
export function pointAt(
  placement: ImagePlacementInput,
  fraction: { x: number; y: number },
): { x: number; y: number } {
  const radians = (placement.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  const centre = { x: placement.x + placement.width / 2, y: placement.y + placement.height / 2 };
  const offset = {
    x: (fraction.x - 0.5) * placement.width,
    y: (fraction.y - 0.5) * placement.height,
  };

  return {
    x: centre.x + offset.x * cos - offset.y * sin,
    y: centre.y + offset.x * sin + offset.y * cos,
  };
}

/** The handles a selected image offers, in reading order. */
export const HANDLES: readonly { handle: Handle; label: string; cursor: string }[] = [
  { handle: { x: 0, y: 1 }, label: 'Top left', cursor: 'nwse-resize' },
  { handle: { x: 0.5, y: 1 }, label: 'Top', cursor: 'ns-resize' },
  { handle: { x: 1, y: 1 }, label: 'Top right', cursor: 'nesw-resize' },
  { handle: { x: 0, y: 0.5 }, label: 'Left', cursor: 'ew-resize' },
  { handle: { x: 1, y: 0.5 }, label: 'Right', cursor: 'ew-resize' },
  { handle: { x: 0, y: 0 }, label: 'Bottom left', cursor: 'nesw-resize' },
  { handle: { x: 0.5, y: 0 }, label: 'Bottom', cursor: 'ns-resize' },
  { handle: { x: 1, y: 0 }, label: 'Bottom right', cursor: 'nwse-resize' },
];
