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
