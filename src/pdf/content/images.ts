import type { ByteRange, ContentOperation } from './parser';
import { findImageGroups, type ImageGroup, type ImageMark } from './imageGroups';
import { applyMatrix, invert, matrixRotation, walkContent, type Matrix } from './state';
import { nameOf, numberOf } from './values';

/**
 * The images a page draws.
 *
 * A page draws an image by mapping the unit square onto the page with the
 * current transform and then saying `Do`. Everything the editor needs follows
 * from that one matrix: where the image sits, how big it is, how far it is
 * turned, and whether it has been mirrored.
 */

export interface ImageFacts {
  /** Pixels across and down, as the image itself states them. */
  width: number;
  height: number;
  /** False for a form XObject, which is a drawing rather than a picture. */
  isImage: boolean;
  /** True when the image carries its own transparency. */
  hasAlpha: boolean;
}

export type XObjectLookup = (name: string) => ImageFacts | undefined;

/** How see-through a named transparency state makes what is drawn with it. */
export type AlphaLookup = (name: string) => number | undefined;

export interface ImagePlacement {
  /** Index of the `Do` operation in the parsed stream. */
  operationIndex: number;
  /** Resource name of the image, without its slash. */
  resourceName: string;
  /** The `/Name Do` operation, for replacing it outright. */
  operationRange: ByteRange;
  /** Where the operand naming the image sits, for pointing it elsewhere. */
  nameRange: ByteRange;
  /** The transform that maps the unit square onto the page. */
  matrix: Matrix;
  /** The box the image occupies in user space. */
  bounds: { x: number; y: number; width: number; height: number };
  /** How far the image is turned, in degrees clockwise. */
  rotation: number;
  /** True when the image is mirrored along its own axes. */
  flippedX: boolean;
  flippedY: boolean;
  /**
   * The part of the image that shows, in its own square, when the page clips
   * it to less than all of it. Null means all of it shows.
   */
  crop: { x: number; y: number; width: number; height: number } | null;
  /** How see-through the page draws it, where 1 is solid. */
  opacity: number;
  facts: ImageFacts;
  /**
   * The `q … Q` that draws this picture and nothing else, with its clip and
   * transparency; null when the picture shares its drawing state.
   */
  group: ImageGroup | null;
  /** PaperForge's marking around a picture it added, which names it. */
  mark: ImageMark | null;
}

/** Every image a content stream draws, in the order it draws them. */
export function extractImages(
  operations: readonly ContentOperation[],
  lookup: XObjectLookup,
  options: { ctm?: Matrix; alphas?: AlphaLookup } = {},
): ImagePlacement[] {
  const images: ImagePlacement[] = [];
  /**
   * The clip in force for the image about to be drawn, in user space. Only a
   * clip set alongside the image counts: an outer one belongs to the page
   * rather than to the picture, and is not the reader's crop.
   */
  let rect: Rect | null = null;
  let clip: Rect | null = null;
  // Transparency is graphics state: it outlasts a `q` and comes back at `Q`.
  let opacity = 1;
  const opacities: number[] = [];

  walkContent(operations, {
    ...(options.ctm === undefined ? {} : { ctm: options.ctm }),
    onOperation: (context) => {
      const { operation, state } = context;

      if (operation.operator === 'q' || operation.operator === 'Q') {
        rect = null;
        clip = null;
        if (operation.operator === 'q') opacities.push(opacity);
        else opacity = opacities.pop() ?? 1;
        return;
      }
      if (operation.operator === 'gs') {
        // Opacity is not an operand of the drawing: it is set in the graphics
        // state, which the page's resources name.
        const name = nameOf(operation.operands[0]);
        const alpha = name === null ? undefined : options.alphas?.(name);
        if (alpha !== undefined) opacity = alpha;
        return;
      }
      if (operation.operator === 're') {
        rect = rectangleOf(operation, state.ctm);
        return;
      }
      if (operation.operator === 'W' || operation.operator === 'W*') {
        clip = rect;
        return;
      }
      if (operation.operator !== 'Do') return;

      const name = nameOf(operation.operands[0]);
      if (name === null) return;
      const facts = lookup(name);
      if (facts === undefined || !facts.isImage) return;

      const nameRange = operation.operandRanges[0];
      if (nameRange === undefined) return;

      images.push({
        operationIndex: context.index,
        resourceName: name,
        operationRange: operation.range,
        nameRange,
        matrix: state.ctm,
        bounds: boundsOf(state.ctm),
        rotation: matrixRotation(state.ctm),
        // A mirrored image has a negative scale down one of its axes.
        flippedX: state.ctm.a * state.ctm.d - state.ctm.b * state.ctm.c < 0,
        flippedY: state.ctm.d < 0 && state.ctm.a >= 0,
        crop: cropOf(clip, state.ctm),
        opacity,
        facts,
        group: null,
        mark: null,
      });
      clip = null;
      rect = null;
    },
  });

  if (images.length === 0) return images;
  const drawn = new Set(images.map((image) => image.operationIndex));
  const { groups, marks } = findImageGroups(operations, (index) => drawn.has(index), options.ctm);
  return images.map((image) => ({
    ...image,
    group: groups.get(image.operationIndex) ?? null,
    mark: marks.get(image.operationIndex) ?? null,
  }));
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A rectangle an `re` operator draws, in user space. */
function rectangleOf(operation: ContentOperation, ctm: Matrix): Rect | null {
  const operands = operation.operands.slice(0, 4);
  if (operands.length < 4 || operands.some((operand) => operand.kind !== 'number')) return null;
  const [x, y, width, height] = operands.map((operand) => numberOf(operand)) as [
    number,
    number,
    number,
    number,
  ];

  const corners = [
    applyMatrix(ctm, x, y),
    applyMatrix(ctm, x + width, y),
    applyMatrix(ctm, x, y + height),
    applyMatrix(ctm, x + width, y + height),
  ];
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const left = Math.min(...xs);
  const bottom = Math.min(...ys);
  return {
    x: left,
    y: bottom,
    width: Math.max(...xs) - left,
    height: Math.max(...ys) - bottom,
  };
}

/** A clip in user space, as the part of the image it leaves showing. */
function cropOf(clip: Rect | null, ctm: Matrix): Rect | null {
  if (clip === null) return null;
  const undo = invert(ctm);
  if (undo === null) return null;

  const first = applyMatrix(undo, clip.x, clip.y);
  const second = applyMatrix(undo, clip.x + clip.width, clip.y + clip.height);
  const x = Math.max(0, Math.min(first.x, second.x));
  const y = Math.max(0, Math.min(first.y, second.y));
  const width = Math.min(1, Math.max(first.x, second.x)) - x;
  const height = Math.min(1, Math.max(first.y, second.y)) - y;

  // A clip that leaves the whole image showing is not a crop.
  if (width >= 0.999 && height >= 0.999) return null;
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

/** The box the unit square occupies once a matrix has had its way with it. */
export function boundsOf(matrix: Matrix): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const corners = [
    applyMatrix(matrix, 0, 0),
    applyMatrix(matrix, 1, 0),
    applyMatrix(matrix, 0, 1),
    applyMatrix(matrix, 1, 1),
  ];
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** Where an image sits, as the reader sees it. */
export interface ImageBox {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  flipX: boolean;
  flipY: boolean;
}

/**
 * The box an image is drawn in, read back out of its matrix.
 *
 * This undoes {@link placementMatrix}: the box is the one the reader drags, so
 * a turned image reports the size it is, not the size of the upright box that
 * would contain it. A mirrored image is always reported as mirrored across x,
 * because mirroring the other way is the same matrix turned half a circle.
 */
export function placementOf(matrix: Matrix): ImageBox {
  const width = Math.hypot(matrix.a, matrix.b);
  const height = Math.hypot(matrix.c, matrix.d);
  const centre = applyMatrix(matrix, 0.5, 0.5);
  const radians = Math.atan2(-matrix.c, matrix.d);
  const degrees = ((((radians * 180) / Math.PI) % 360) + 360) % 360;

  return {
    x: centre.x - width / 2,
    y: centre.y - height / 2,
    width,
    height,
    rotation: Math.round(degrees * 100) / 100,
    flipX: matrix.a * matrix.d - matrix.b * matrix.c < 0,
    flipY: false,
  };
}

/**
 * The matrix that puts an image in a box, turned and mirrored as asked.
 *
 * The box is what the reader sees: the image is fitted into it after the
 * rotation, which is what dragging a handle means.
 */
export function placementMatrix(placement: {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  flipX: boolean;
  flipY: boolean;
}): Matrix {
  const radians = (placement.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  // The unit square is mirrored, then scaled to the box, then turned about
  // its own middle, then moved to where the box is.
  const scaleX = placement.flipX ? -placement.width : placement.width;
  const scaleY = placement.flipY ? -placement.height : placement.height;
  const offsetX = placement.flipX ? placement.width : 0;
  const offsetY = placement.flipY ? placement.height : 0;

  const half = { x: placement.width / 2, y: placement.height / 2 };
  const centred: Matrix = {
    a: scaleX,
    b: 0,
    c: 0,
    d: scaleY,
    e: offsetX - half.x,
    f: offsetY - half.y,
  };
  const turn: Matrix = { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
  const move: Matrix = {
    a: 1,
    b: 0,
    c: 0,
    d: 1,
    e: placement.x + half.x,
    f: placement.y + half.y,
  };

  return multiplyAll([centred, turn, move]);
}

function multiplyAll(matrices: readonly Matrix[]): Matrix {
  return matrices.reduce((result, matrix) => ({
    a: result.a * matrix.a + result.b * matrix.c,
    b: result.a * matrix.b + result.b * matrix.d,
    c: result.c * matrix.a + result.d * matrix.c,
    d: result.c * matrix.b + result.d * matrix.d,
    e: result.e * matrix.a + result.f * matrix.c + matrix.e,
    f: result.e * matrix.b + result.f * matrix.d + matrix.f,
  }));
}
