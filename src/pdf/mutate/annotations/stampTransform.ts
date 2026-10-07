import { PDFArray, PDFDict, PDFName, PDFNumber, PDFStream, type PDFDocument } from 'pdf-lib';
import type { AnnotationGeometry, AnnotationRect } from '@shared/schemas/annotation';

/**
 * Turning and resizing a stamp, in a way every reader draws.
 *
 * A reader draws an annotation by taking its appearance's `/BBox`, putting it
 * through the appearance's `/Matrix`, and stretching whatever box that makes
 * onto the annotation's `/Rect`. So the turn goes in the `/Matrix`, and the
 * `/Rect` is made exactly the box the turned stamp occupies — then the stretch
 * is no stretch at all, and the stamp is drawn turned and at its true size.
 *
 * The same `/Matrix` resizes a stamp whose picture PaperForge cannot draw
 * again, such as a signature from an earlier session: it maps the box the
 * picture was drawn in onto the box it should now fill, exactly, rather than
 * leaving the reader to stretch the padding around it along with it.
 *
 * PDF has no portable place to say a stamp is turned, so the turn and the
 * stamp's own upright box are kept as PaperForge entries, `/PFRotate` and
 * `/PFRect`, which other readers ignore.
 */

/** The kinds of mark that are a box, which can be turned and duplicated. */
export const BOX_KINDS: ReadonlySet<AnnotationGeometry['kind']> = new Set([
  'freeText',
  'square',
  'circle',
  'stamp',
  'imageStamp',
]);

/** The kinds that are turned, rather than only moved and resized. */
export function isStampKind(kind: AnnotationGeometry['kind']): boolean {
  return kind === 'stamp' || kind === 'imageStamp';
}

export const ROTATE_KEY = 'PFRotate';
export const UPRIGHT_KEY = 'PFRect';

type Matrix = [number, number, number, number, number, number];

export interface StampPlacement {
  /** The appearance's `/Matrix`. */
  matrix: Matrix;
  /** The `/Rect` that makes the reader's stretch an identity. */
  rect: AnnotationRect;
}

/**
 * Where a stamp's appearance goes: `inner` is the box the picture was drawn
 * in, in the appearance's own space; `target` is the upright box it should
 * fill on the page, turned anticlockwise by `rotation` about its middle.
 */
export function placeStamp(
  bbox: AnnotationRect,
  inner: AnnotationRect,
  target: AnnotationRect,
  rotation: number,
): StampPlacement {
  const radians = (rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const scaleX = inner.width > 0 ? target.width / inner.width : 1;
  const scaleY = inner.height > 0 ? target.height / inner.height : 1;
  const from = { x: inner.x + inner.width / 2, y: inner.y + inner.height / 2 };
  const to = { x: target.x + target.width / 2, y: target.y + target.height / 2 };

  // From the picture's middle, stretched to size, turned, then to its place.
  const a = scaleX * cos;
  const b = scaleX * sin;
  const c = -scaleY * sin;
  const d = scaleY * cos;
  const matrix: Matrix = [
    a,
    b,
    c,
    d,
    to.x - (a * from.x + c * from.y),
    to.y - (b * from.x + d * from.y),
  ];

  const corners = [
    [bbox.x, bbox.y],
    [bbox.x + bbox.width, bbox.y],
    [bbox.x, bbox.y + bbox.height],
    [bbox.x + bbox.width, bbox.y + bbox.height],
  ].map(([x = 0, y = 0]) => ({
    x: a * x + c * y + matrix[4],
    y: b * x + d * y + matrix[5],
  }));
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const left = Math.min(...xs);
  const bottom = Math.min(...ys);
  return {
    matrix: matrix.map(round) as Matrix,
    rect: { x: left, y: bottom, width: Math.max(...xs) - left, height: Math.max(...ys) - bottom },
  };
}

/** Writes the turn onto an annotation's appearance and records it on the annotation. */
export function applyStampPlacement(
  document: PDFDocument,
  annotation: PDFDict,
  appearance: PDFStream,
  placement: StampPlacement,
  upright: AnnotationRect,
  rotation: number,
): void {
  const { context } = document;
  const { rect } = placement;
  appearance.dict.set(PDFName.of('Matrix'), context.obj(placement.matrix));
  annotation.set(
    PDFName.of('Rect'),
    context.obj([rect.x, rect.y, rect.x + rect.width, rect.y + rect.height].map(round)),
  );

  if (isTurned(rotation)) {
    // A turned stamp's rectangle is not its box, so `/RD` cannot describe it.
    annotation.delete(PDFName.of('RD'));
    annotation.set(PDFName.of(ROTATE_KEY), PDFNumber.of(round(normalized(rotation))));
    annotation.set(
      PDFName.of(UPRIGHT_KEY),
      context.obj(
        [upright.x, upright.y, upright.x + upright.width, upright.y + upright.height].map(round),
      ),
    );
  } else {
    annotation.set(
      PDFName.of('RD'),
      context.obj(
        [
          upright.x - rect.x,
          upright.y - rect.y,
          rect.x + rect.width - (upright.x + upright.width),
          rect.y + rect.height - (upright.y + upright.height),
        ].map((value) => Math.max(0, round(value))),
      ),
    );
    clearTurn(annotation);
  }
}

/** Takes PaperForge's record of a turn off an annotation that is upright again. */
export function clearTurn(annotation: PDFDict): void {
  annotation.delete(PDFName.of(ROTATE_KEY));
  annotation.delete(PDFName.of(UPRIGHT_KEY));
}

/** The normal appearance of an annotation, when it is a single stream. */
export function normalAppearance(annotation: PDFDict): PDFStream | undefined {
  const appearances = annotation.lookup(PDFName.of('AP'));
  if (!(appearances instanceof PDFDict)) return undefined;
  const normal = appearances.lookup(PDFName.of('N'));
  return normal instanceof PDFStream ? normal : undefined;
}

/** An appearance's `/BBox`, as a rectangle. */
export function bboxOf(appearance: PDFStream): AnnotationRect | undefined {
  const box = appearance.dict.lookup(PDFName.of('BBox'));
  if (!(box instanceof PDFArray) || box.size() < 4) return undefined;
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = [0, 1, 2, 3].map((index) => {
    const value = box.lookup(index);
    return value instanceof PDFNumber ? value.asNumber() : 0;
  });
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}

/**
 * How far an annotation PaperForge turned is turned, and its upright box,
 * kept beside its rectangle's middle: a reader that moves the rectangle moves
 * the stamp, and the box goes with it. Null for an upright one.
 */
export function readTurn(
  annotation: PDFDict,
  outer: AnnotationRect,
): { rotation: number; upright: AnnotationRect } | null {
  const rotation = annotation.lookup(PDFName.of(ROTATE_KEY));
  const upright = annotation.lookup(PDFName.of(UPRIGHT_KEY));
  if (!(rotation instanceof PDFNumber) || !(upright instanceof PDFArray) || upright.size() < 4) {
    return null;
  }
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = [0, 1, 2, 3].map((index) => {
    const value = upright.lookup(index);
    return value instanceof PDFNumber ? value.asNumber() : 0;
  });
  const width = Math.abs(x2 - x1);
  const height = Math.abs(y2 - y1);
  const middle = { x: outer.x + outer.width / 2, y: outer.y + outer.height / 2 };
  return {
    rotation: normalized(rotation.asNumber()),
    upright: { x: middle.x - width / 2, y: middle.y - height / 2, width, height },
  };
}

export function isTurned(rotation: number | undefined): boolean {
  if (rotation === undefined) return false;
  const turn = normalized(rotation);
  return turn > 1e-6 && turn < 360 - 1e-6;
}

function normalized(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
