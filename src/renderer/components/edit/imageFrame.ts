import type { CSSProperties } from 'react';
import type { PdfPageGeometry } from '@pdf/render/types';
import type { ImagePlacementInput } from '@shared/schemas/edit';
import { pdfRectToCss, quarterTurns } from '../viewer/pageGeometry';

/**
 * Where an image's box sits on screen: placed upright about its middle and
 * then turned, so a box drawn this way lines up with the picture however far
 * round the image and the view are turned.
 */
export interface ImageFrame {
  centre: { x: number; y: number };
  width: number;
  height: number;
  /** Clockwise, on screen. */
  degrees: number;
  flipX: boolean;
}

export function imageFrame(
  placement: ImagePlacementInput,
  geometry: PdfPageGeometry,
  scale: number,
  rotation: number,
): ImageFrame | null {
  const box = pdfRectToCss(placement, geometry, scale, rotation);
  if (box === null) return null;
  const turns = quarterTurns(geometry.rotation + rotation);
  return {
    centre: { x: box.left + box.width / 2, y: box.top + box.height / 2 },
    width: turns % 2 === 0 ? box.width : box.height,
    height: turns % 2 === 0 ? box.height : box.width,
    degrees: turns * 90 - placement.rotation,
    flipX: placement.flipX,
  };
}

export function frameStyle(frame: ImageFrame): CSSProperties {
  return {
    left: `${String(frame.centre.x - frame.width / 2)}px`,
    top: `${String(frame.centre.y - frame.height / 2)}px`,
    width: `${String(frame.width)}px`,
    height: `${String(frame.height)}px`,
    transform: `rotate(${String(frame.degrees)}deg)${frame.flipX ? ' scaleX(-1)' : ''}`,
  };
}

/**
 * The image's pixels as the page shows them now, turned upright into the
 * image's own axes — the inverse of `frameStyle`, so drawing the copy into a
 * box styled that way puts every pixel back where it was, and drawing it into
 * a moved or resized box is the picture moved or resized.
 *
 * `layer` is any element covering the page, whose top-left corner the frame
 * is measured from.
 */
export function snapshotImage(layer: HTMLElement, frame: ImageFrame): HTMLCanvasElement | null {
  const canvas = layer.closest('[data-page-number]')?.querySelector('canvas') ?? null;
  if (canvas === null || canvas.width === 0) return null;
  const canvasBox = canvas.getBoundingClientRect();
  const layerBox = layer.getBoundingClientRect();
  if (canvasBox.width === 0 || canvasBox.height === 0) return null;

  const ratio = canvas.width / canvasBox.width;
  const copy = window.document.createElement('canvas');
  copy.width = Math.max(1, Math.round(frame.width * ratio));
  copy.height = Math.max(1, Math.round(frame.height * ratio));
  const context = copy.getContext('2d');
  if (context === null) return null;

  // Read right to left: from the canvas's own corner to the image's middle,
  // turned back upright, unflipped, and into the copy's pixels.
  context.translate(copy.width / 2, copy.height / 2);
  context.scale(ratio, ratio);
  if (frame.flipX) context.scale(-1, 1);
  context.rotate((-frame.degrees * Math.PI) / 180);
  context.translate(
    -(frame.centre.x - (canvasBox.left - layerBox.left)),
    -(frame.centre.y - (canvasBox.top - layerBox.top)),
  );
  context.drawImage(canvas, 0, 0, canvasBox.width, canvasBox.height);
  return copy;
}
