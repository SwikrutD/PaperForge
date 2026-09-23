import type { ByteRange, ContentOperation } from './parser';
import { applyMatrix, matrixRotation, walkContent, type Matrix } from './state';
import { nameOf } from './values';

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
  facts: ImageFacts;
}

/** Every image a content stream draws, in the order it draws them. */
export function extractImages(
  operations: readonly ContentOperation[],
  lookup: XObjectLookup,
  ctm?: Matrix,
): ImagePlacement[] {
  const images: ImagePlacement[] = [];

  walkContent(operations, {
    ...(ctm === undefined ? {} : { ctm }),
    onOperation: (context) => {
      const { operation, state } = context;
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
        facts,
      });
    },
  });

  return images;
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
