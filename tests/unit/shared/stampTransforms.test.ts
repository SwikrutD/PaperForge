import { describe, expect, it } from 'vitest';
import { AnnotationMode, getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  DEFAULT_ANNOTATION_STYLE,
  type Annotation,
  type AnnotationInput,
} from '../../../src/shared/schemas/annotation';
import { PdfLibMutationEngine } from '../../../src/pdf/mutate/pdfLibEngine';
import type { StagedAsset } from '../../../src/pdf/mutate/types';
import { threePageDocument } from '../../fixtures/pdf';
import { pngPixel } from '../../fixtures/images';

/**
 * Resizing, turning and duplicating the stamps and signatures PaperForge
 * makes.
 *
 * A stamp's picture is its appearance stream, which a reader maps onto the
 * annotation's rectangle. Turning one puts the turn in the appearance's
 * `/Matrix` and makes the rectangle the box the turned stamp needs, so every
 * reader draws it turned, not only PaperForge. Each case is read back with
 * PDF.js, which is what the viewer draws with.
 */

const engine = new PdfLibMutationEngine();

const RECT = { x: 100, y: 500, width: 120, height: 40 };

function stamp(overrides: Partial<AnnotationInput> = {}): AnnotationInput {
  return {
    pageNumber: 1,
    geometry: { kind: 'stamp', rect: RECT },
    style: { ...DEFAULT_ANNOTATION_STYLE, borderWidth: 0 },
    contents: '',
    author: 'Tester',
    subject: '',
    stampLabel: 'Approved',
    ...overrides,
  };
}

const SIGNATURE = new Map<string, StagedAsset>([
  ['sig', { kind: 'image', bytes: pngPixel(30, 10), format: 'png', width: 30, height: 10 }],
]);

function signature(): AnnotationInput {
  return {
    pageNumber: 1,
    geometry: { kind: 'imageStamp', rect: RECT },
    style: { ...DEFAULT_ANNOTATION_STYLE, borderWidth: 0 },
    contents: '',
    author: 'Tester',
    subject: '',
    imageToken: 'sig',
  };
}

async function withAnnotation(
  input: AnnotationInput,
  assets?: ReadonlyMap<string, StagedAsset>,
): Promise<{ bytes: Uint8Array; annotation: Annotation }> {
  const { bytes } = await engine.apply(
    threePageDocument(),
    [{ kind: 'addAnnotations', annotations: [input] }],
    assets,
  );
  const [annotation] = await engine.readAnnotations(bytes);
  return { bytes, annotation: annotation! };
}

/**
 * The transform PDF.js draws each annotation's appearance with, mapping the
 * appearance's own space onto the page, in page order.
 */
async function drawnWith(bytes: Uint8Array): Promise<number[][]> {
  const task = getDocument({ data: new Uint8Array(bytes) });
  const document = await task.promise;
  const page = await document.getPage(1);
  const list = await page.getOperatorList({ annotationMode: AnnotationMode.ENABLE });
  await task.destroy();

  const transforms: number[][] = [];
  list.fnArray.forEach((fn, index) => {
    if (fn !== OPS.beginAnnotation) return;
    const [, , transform, matrix] = list.argsArray[index] as [string, number[], number[], number[]];
    // The appearance's own /Matrix first, then the fit onto the rectangle.
    transforms.push(compose(matrix, transform));
  });
  return transforms;
}

function compose(first: number[], second: number[]): number[] {
  const [a1 = 1, b1 = 0, c1 = 0, d1 = 1, e1 = 0, f1 = 0] = first;
  const [a2 = 1, b2 = 0, c2 = 0, d2 = 1, e2 = 0, f2 = 0] = second;
  return [
    a1 * a2 + b1 * c2,
    a1 * b2 + b1 * d2,
    c1 * a2 + d1 * c2,
    c1 * b2 + d1 * d2,
    e1 * a2 + f1 * c2 + e2,
    e1 * b2 + f1 * d2 + f2,
  ];
}

/** How far a transform turns things, anticlockwise, in degrees. */
function turnOf(transform: number[]): number {
  const degrees = (Math.atan2(transform[1] ?? 0, transform[0] ?? 1) * 180) / Math.PI;
  return Math.round(((degrees % 360) + 360) % 360);
}

/** How much a transform stretches each of its axes. */
function stretchOf(transform: number[]): { x: number; y: number } {
  return {
    x: Math.hypot(transform[0] ?? 0, transform[1] ?? 0),
    y: Math.hypot(transform[2] ?? 0, transform[3] ?? 0),
  };
}

describe('turning a stamp', () => {
  it('draws it turned, about its own middle, in any reader', async () => {
    const { bytes } = await withAnnotation(stamp({ rotation: 30 }));
    const [transform] = await drawnWith(bytes);

    expect(turnOf(transform!)).toBe(30);
    const stretch = stretchOf(transform!);
    expect(stretch.x).toBeCloseTo(1, 4);
    expect(stretch.y).toBeCloseTo(1, 4);
  });

  it('reads back as the stamp it was, turned', async () => {
    const { annotation } = await withAnnotation(stamp({ rotation: 30 }));

    expect(annotation.rotation).toBeCloseTo(30, 4);
    expect(annotation.geometry.kind).toBe('stamp');
    const rect = annotation.geometry.kind === 'stamp' ? annotation.geometry.rect : null;
    expect(rect?.width).toBeCloseTo(120, 4);
    expect(rect?.height).toBeCloseTo(40, 4);
    expect((rect?.x ?? 0) + (rect?.width ?? 0) / 2).toBeCloseTo(160, 4);
    expect((rect?.y ?? 0) + (rect?.height ?? 0) / 2).toBeCloseTo(520, 4);
  });

  it('turns one already on the page, and turns it back', async () => {
    const { bytes, annotation } = await withAnnotation(stamp());
    const turned = await engine.apply(bytes, [
      { kind: 'updateAnnotations', updates: [{ id: annotation.id, patch: { rotation: 90 } }] },
    ]);
    expect(turnOf((await drawnWith(turned.bytes))[0]!)).toBe(90);
    expect((await engine.readAnnotations(turned.bytes))[0]?.rotation).toBeCloseTo(90, 4);

    const back = await engine.apply(turned.bytes, [
      { kind: 'updateAnnotations', updates: [{ id: annotation.id, patch: { rotation: 0 } }] },
    ]);
    expect(turnOf((await drawnWith(back.bytes))[0]!)).toBe(0);
    const read = (await engine.readAnnotations(back.bytes))[0];
    expect(read?.rotation ?? 0).toBe(0);
    expect(read?.geometry.kind === 'stamp' ? read.geometry.rect : null).toEqual(RECT);
  });

  it('keeps its turn when it is moved', async () => {
    const { bytes, annotation } = await withAnnotation(stamp({ rotation: 45 }));
    const moved = await engine.apply(bytes, [
      {
        kind: 'updateAnnotations',
        updates: [
          {
            id: annotation.id,
            patch: { geometry: { kind: 'stamp', rect: { ...RECT, x: 300 } } },
          },
        ],
      },
    ]);
    const read = (await engine.readAnnotations(moved.bytes))[0];
    expect(read?.rotation).toBeCloseTo(45, 4);
    expect(read?.geometry.kind === 'stamp' ? read.geometry.rect.x : 0).toBeCloseTo(300, 4);
  });
});

describe('a signature from an earlier session', () => {
  // Read back, a signature has no picture to hand: its appearance is kept as
  // it is, and the change is made by how it is mapped onto the page.
  it('resizes without losing its picture', async () => {
    const { bytes, annotation } = await withAnnotation(signature(), SIGNATURE);
    const resized = await engine.apply(bytes, [
      {
        kind: 'updateAnnotations',
        updates: [
          {
            id: annotation.id,
            patch: { geometry: { kind: 'stamp', rect: { ...RECT, width: 240, height: 80 } } },
          },
        ],
      },
    ]);

    const [transform] = await drawnWith(resized.bytes);
    const stretch = stretchOf(transform!);
    expect(stretch.x).toBeCloseTo(2, 3);
    expect(stretch.y).toBeCloseTo(2, 3);
    const read = (await engine.readAnnotations(resized.bytes))[0];
    expect(read?.geometry.kind === 'stamp' ? read.geometry.rect.width : 0).toBeCloseTo(240, 3);
  });

  it('turns without being squashed', async () => {
    const { bytes, annotation } = await withAnnotation(signature(), SIGNATURE);
    const turned = await engine.apply(bytes, [
      { kind: 'updateAnnotations', updates: [{ id: annotation.id, patch: { rotation: 30 } }] },
    ]);

    const [transform] = await drawnWith(turned.bytes);
    expect(turnOf(transform!)).toBe(30);
    const stretch = stretchOf(transform!);
    expect(stretch.x).toBeCloseTo(1, 3);
    expect(stretch.y).toBeCloseTo(1, 3);
  });
});

describe('duplicating a stamp', () => {
  it('makes a copy beside it, under the name asked for, and leaves the original', async () => {
    const { bytes, annotation } = await withAnnotation(signature(), SIGNATURE);
    const turned = await engine.apply(bytes, [
      { kind: 'updateAnnotations', updates: [{ id: annotation.id, patch: { rotation: 15 } }] },
    ]);

    const result = await engine.apply(turned.bytes, [
      {
        kind: 'duplicateAnnotations',
        copies: [{ id: annotation.id, newId: 'pf-copy-1' }],
        dx: 20,
        dy: -30,
      },
    ]);
    const read = await engine.readAnnotations(result.bytes);
    const original = read.find((entry) => entry.id === annotation.id);
    const copy = read.find((entry) => entry.id === 'pf-copy-1');

    expect(read).toHaveLength(2);
    expect(copy?.rotation).toBeCloseTo(15, 4);
    const at = (entry: Annotation | undefined): { x: number; y: number } | null =>
      entry?.geometry.kind === 'stamp' ? entry.geometry.rect : null;
    expect(at(copy)?.x).toBeCloseTo((at(original)?.x ?? 0) + 20, 4);
    expect(at(copy)?.y).toBeCloseTo((at(original)?.y ?? 0) - 30, 4);

    // Both are drawn, the same way.
    const transforms = await drawnWith(result.bytes);
    expect(transforms).toHaveLength(2);
    expect(turnOf(transforms[1]!)).toBe(15);
  });

  it('gives the copy an appearance of its own, so changing one leaves the other', async () => {
    const { bytes, annotation } = await withAnnotation(signature(), SIGNATURE);
    const copied = await engine.apply(bytes, [
      {
        kind: 'duplicateAnnotations',
        copies: [{ id: annotation.id, newId: 'pf-copy-2' }],
        dx: 0,
        dy: -60,
      },
    ]);
    const turned = await engine.apply(copied.bytes, [
      { kind: 'updateAnnotations', updates: [{ id: 'pf-copy-2', patch: { rotation: 90 } }] },
    ]);

    const transforms = await drawnWith(turned.bytes);
    expect(turnOf(transforms[0]!)).toBe(0);
    expect(turnOf(transforms[1]!)).toBe(90);
  });

  it('refuses a mark that is not a box, which a copy would have to redraw', async () => {
    const { bytes, annotation } = await withAnnotation({
      ...stamp(),
      geometry: {
        kind: 'ink',
        strokes: [
          [
            { x: 1, y: 1 },
            { x: 50, y: 50 },
          ],
        ],
      },
    });
    await expect(
      engine.apply(bytes, [
        {
          kind: 'duplicateAnnotations',
          copies: [{ id: annotation.id, newId: 'pf-copy-3' }],
          dx: 10,
          dy: 10,
        },
      ]),
    ).rejects.toThrow(/cannot be duplicated/i);
  });
});
