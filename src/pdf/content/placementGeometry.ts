import { applyMatrix, type Matrix } from './state';

/**
 * The box a reader drags, and the matrix that draws an image in it.
 */

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
