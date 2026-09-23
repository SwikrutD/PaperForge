import { describe, expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  DEFAULT_ANNOTATION_STYLE,
  type AnnotationGeometry,
  type AnnotationInput,
} from '../../../src/shared/schemas/annotation';
import { PdfLibMutationEngine } from '../../../src/pdf/mutate/pdfLibEngine';
import { threePageDocument } from '../../fixtures/pdf';

/**
 * Annotations, written with pdf-lib and read back with PDF.js.
 *
 * PDF.js is what PaperForge's viewer uses and is an independent reader of the
 * file, so if it finds the annotation with the right subtype, geometry and
 * appearance stream, so will anything else.
 */
const engine = new PdfLibMutationEngine();

function input(
  geometry: AnnotationGeometry,
  overrides: Partial<AnnotationInput> = {},
): AnnotationInput {
  return {
    pageNumber: 1,
    geometry,
    style: DEFAULT_ANNOTATION_STYLE,
    contents: '',
    author: 'Tester',
    subject: '',
    ...overrides,
  } satisfies AnnotationInput;
}

interface ReadAnnotation {
  subtype: string;
  rect: number[];
  /** PDF.js reports the text with the direction it should be laid out in. */
  contentsObj: { str: string } | null;
  titleObj: { str: string } | null;
  hasAppearance: boolean;
  quadPoints?: unknown;
  inkLists?: unknown;
  vertices?: unknown;
  lineCoordinates?: unknown;
  color?: Uint8ClampedArray | null;
}

/** Every annotation PDF.js finds on a page of the given document. */
async function annotationsOnPage(bytes: Uint8Array, pageNumber = 1): Promise<ReadAnnotation[]> {
  const task = getDocument({ data: new Uint8Array(bytes) });
  const document = await task.promise;
  const page = await document.getPage(pageNumber);
  const annotations = (await page.getAnnotations({ intent: 'display' })) as ReadAnnotation[];
  await task.destroy();
  return annotations;
}

async function add(
  bytes: Uint8Array,
  annotations: AnnotationInput[],
): Promise<{ bytes: Uint8Array }> {
  return engine.apply(bytes, [{ kind: 'addAnnotations', annotations }]);
}

const QUAD = [72, 700, 200, 700, 72, 686, 200, 686];

describe('writing annotations', () => {
  it('writes a highlight as a Highlight annotation with quad points', async () => {
    const result = await add(threePageDocument(), [
      input({ kind: 'highlight', quads: [QUAD] }, { contents: 'Worth reading' }),
    ]);

    const [annotation] = await annotationsOnPage(result.bytes);
    expect(annotation?.subtype).toBe('Highlight');
    expect(annotation?.contentsObj?.str).toBe('Worth reading');
    expect(annotation?.titleObj?.str).toBe('Tester');
    expect(annotation?.hasAppearance).toBe(true);
    // The marked area is where the words are.
    expect(annotation?.rect[0]).toBeCloseTo(71, 0);
    expect(annotation?.rect[3]).toBeCloseTo(701, 0);
  });

  it('writes each text markup kind as its own subtype', async () => {
    const kinds = ['underline', 'strikeOut', 'squiggly'] as const;
    const result = await add(
      threePageDocument(),
      kinds.map((kind) => input({ kind, quads: [QUAD] })),
    );

    const annotations = await annotationsOnPage(result.bytes);
    expect(annotations.map((annotation) => annotation.subtype)).toEqual([
      'Underline',
      'StrikeOut',
      'Squiggly',
    ]);
    expect(annotations.every((annotation) => annotation.hasAppearance)).toBe(true);
  });

  it('writes shapes, ink and notes as the annotations they are', async () => {
    const result = await add(threePageDocument(), [
      input({ kind: 'note', point: { x: 100, y: 600 } }, { contents: 'Look here' }),
      input({ kind: 'square', rect: { x: 100, y: 400, width: 120, height: 80 } }),
      input({ kind: 'circle', rect: { x: 250, y: 400, width: 120, height: 80 } }),
      input({ kind: 'line', from: { x: 100, y: 300 }, to: { x: 300, y: 340 } }),
      input({ kind: 'arrow', from: { x: 100, y: 250 }, to: { x: 300, y: 290 } }),
      input({
        kind: 'polygon',
        vertices: [
          { x: 400, y: 200 },
          { x: 460, y: 260 },
          { x: 420, y: 300 },
        ],
      }),
      input({
        kind: 'polyline',
        vertices: [
          { x: 100, y: 150 },
          { x: 180, y: 190 },
        ],
      }),
      input({
        kind: 'ink',
        strokes: [
          [
            { x: 100, y: 100 },
            { x: 140, y: 130 },
            { x: 180, y: 90 },
          ],
        ],
      }),
    ]);

    const annotations = await annotationsOnPage(result.bytes);
    expect(annotations.map((annotation) => annotation.subtype)).toEqual([
      'Text',
      'Square',
      'Circle',
      'Line',
      'Line',
      'Polygon',
      'PolyLine',
      'Ink',
    ]);
    expect(annotations.every((annotation) => annotation.hasAppearance)).toBe(true);

    // The entries each subtype is defined by are really there.
    expect(annotations[3]?.lineCoordinates).toEqual([100, 300, 300, 340]);
    expect(annotations[5]?.vertices).toBeDefined();
    expect(annotations[7]?.inkLists).toBeDefined();
  });

  it('writes a text box and a callout with the text in them', async () => {
    const result = await add(threePageDocument(), [
      input(
        { kind: 'freeText', rect: { x: 72, y: 500, width: 200, height: 60 } },
        { contents: 'A remark that is long enough to need more than one line in the box' },
      ),
      input(
        {
          kind: 'callout',
          rect: { x: 300, y: 500, width: 160, height: 50 },
          callout: [
            { x: 250, y: 450 },
            { x: 290, y: 500 },
          ],
        },
        { contents: 'Pointing at something' },
      ),
    ]);

    const annotations = await annotationsOnPage(result.bytes);
    expect(annotations.map((annotation) => annotation.subtype)).toEqual(['FreeText', 'FreeText']);
    expect(annotations[0]?.contentsObj?.str).toContain('more than one line');
    expect(annotations.every((annotation) => annotation.hasAppearance)).toBe(true);
  });

  it('keeps a comment written in another alphabet', async () => {
    const result = await add(threePageDocument(), [
      input(
        { kind: 'highlight', quads: [QUAD] },
        { contents: 'Καλημέρα — 早上好', author: 'Ünal' },
      ),
    ]);

    const [annotation] = await annotationsOnPage(result.bytes);
    expect(annotation?.contentsObj?.str).toBe('Καλημέρα — 早上好');
    expect(annotation?.titleObj?.str).toBe('Ünal');
  });

  it('puts an annotation on the page it belongs to', async () => {
    const result = await add(threePageDocument(), [
      input({ kind: 'square', rect: { x: 100, y: 400, width: 50, height: 50 } }, { pageNumber: 3 }),
    ]);

    expect(await annotationsOnPage(result.bytes, 1)).toHaveLength(0);
    expect(await annotationsOnPage(result.bytes, 3)).toHaveLength(1);
  });
});

describe('reading annotations back', () => {
  it('finds what it wrote, with its geometry and style intact', async () => {
    const written = await add(threePageDocument(), [
      input(
        { kind: 'square', rect: { x: 100, y: 400, width: 120, height: 80 } },
        {
          contents: 'A note about the box',
          subject: 'Layout',
          style: {
            ...DEFAULT_ANNOTATION_STYLE,
            color: { r: 1, g: 0, b: 0 },
            fillColor: { r: 0, g: 0, b: 1 },
            borderWidth: 3,
            borderStyle: 'dashed',
            opacity: 0.5,
          },
        },
      ),
    ]);

    const [annotation] = await engine.readAnnotations(written.bytes);
    expect(annotation?.geometry.kind).toBe('square');
    expect(annotation?.contents).toBe('A note about the box');
    expect(annotation?.subject).toBe('Layout');
    expect(annotation?.author).toBe('Tester');
    expect(annotation?.style.color).toEqual({ r: 1, g: 0, b: 0 });
    expect(annotation?.style.fillColor).toEqual({ r: 0, g: 0, b: 1 });
    expect(annotation?.style.borderStyle).toBe('dashed');
    expect(annotation?.style.opacity).toBeCloseTo(0.5, 2);
    expect(annotation?.editable).toBe(true);
    expect(annotation?.createdAt).not.toBeNull();
    expect(annotation?.id).toMatch(/^pf-/);
  });

  it('gives every annotation an identity that survives a rewrite', async () => {
    const first = await add(threePageDocument(), [input({ kind: 'highlight', quads: [QUAD] })]);
    const [before] = await engine.readAnnotations(first.bytes);

    // Any other change rewrites the whole file.
    const second = await engine.apply(first.bytes, [
      { kind: 'rotatePages', pages: [2], degrees: 90 },
    ]);
    const [after] = await engine.readAnnotations(second.bytes);

    expect(after?.id).toBe(before?.id);
  });

  it('reads each kind back as the kind it was', async () => {
    const written = await add(threePageDocument(), [
      input({ kind: 'underline', quads: [QUAD] }),
      input({ kind: 'note', point: { x: 100, y: 600 } }),
      input({ kind: 'arrow', from: { x: 100, y: 250 }, to: { x: 300, y: 290 } }),
      input({ kind: 'line', from: { x: 100, y: 200 }, to: { x: 300, y: 240 } }),
      input({
        kind: 'ink',
        strokes: [
          [
            { x: 10, y: 10 },
            { x: 20, y: 20 },
          ],
        ],
      }),
      input(
        {
          kind: 'callout',
          rect: { x: 300, y: 500, width: 160, height: 50 },
          callout: [
            { x: 250, y: 450 },
            { x: 290, y: 500 },
          ],
        },
        { contents: 'Here' },
      ),
    ]);

    const annotations = await engine.readAnnotations(written.bytes);
    expect(annotations.map((annotation) => annotation.geometry.kind)).toEqual([
      'underline',
      'note',
      'arrow',
      'line',
      'ink',
      'callout',
    ]);
  });

  it('lists an annotation from another application too', async () => {
    // A Square with no /NM, which is what most producers write.
    const written = await add(threePageDocument(), [
      input({ kind: 'square', rect: { x: 10, y: 10, width: 30, height: 30 } }),
    ]);
    const annotations = await engine.readAnnotations(written.bytes);
    expect(annotations).toHaveLength(1);
    expect(annotations[0]?.pageNumber).toBe(1);
  });
});

describe('changing and removing annotations', () => {
  it('changes colour, text and status without moving the annotation', async () => {
    const written = await add(threePageDocument(), [
      input({ kind: 'square', rect: { x: 100, y: 400, width: 120, height: 80 } }),
    ]);
    const [original] = await engine.readAnnotations(written.bytes);

    const changed = await engine.apply(written.bytes, [
      {
        kind: 'updateAnnotations',
        updates: [
          {
            id: original?.id ?? '',
            patch: {
              style: { color: { r: 0, g: 0.6, b: 0.2 } },
              contents: 'Changed my mind',
              resolved: true,
            },
          },
        ],
      },
    ]);

    const [updated] = await engine.readAnnotations(changed.bytes);
    expect(updated?.id).toBe(original?.id);
    expect(updated?.style.color).toEqual({ r: 0, g: 0.6, b: 0.2 });
    expect(updated?.contents).toBe('Changed my mind');
    expect(updated?.resolved).toBe(true);
    expect(updated?.geometry).toEqual(original?.geometry);
  });

  it('moves an annotation when the change carries new geometry', async () => {
    const written = await add(threePageDocument(), [
      input({ kind: 'circle', rect: { x: 100, y: 400, width: 60, height: 60 } }),
    ]);
    const [original] = await engine.readAnnotations(written.bytes);

    const moved = await engine.apply(written.bytes, [
      {
        kind: 'updateAnnotations',
        updates: [
          {
            id: original?.id ?? '',
            patch: {
              geometry: { kind: 'circle', rect: { x: 300, y: 200, width: 60, height: 60 } },
            },
          },
        ],
      },
    ]);

    const [updated] = await engine.readAnnotations(moved.bytes);
    expect(updated?.geometry).toMatchObject({
      kind: 'circle',
      rect: { x: expect.closeTo(300, 0) as number, y: expect.closeTo(200, 0) as number },
    });
  });

  it('deletes an annotation and leaves the others alone', async () => {
    const written = await add(threePageDocument(), [
      input({ kind: 'square', rect: { x: 10, y: 10, width: 30, height: 30 } }),
      input({ kind: 'circle', rect: { x: 60, y: 10, width: 30, height: 30 } }),
    ]);
    const [first, second] = await engine.readAnnotations(written.bytes);

    const removed = await engine.apply(written.bytes, [
      { kind: 'deleteAnnotations', ids: [first?.id ?? ''] },
    ]);

    const remaining = await engine.readAnnotations(removed.bytes);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe(second?.id);
    expect(await annotationsOnPage(removed.bytes)).toHaveLength(1);
  });

  it('survives a save, a reopen and another change', async () => {
    const first = await add(threePageDocument(), [
      input({ kind: 'highlight', quads: [QUAD] }, { contents: 'First' }),
    ]);
    const [original] = await engine.readAnnotations(first.bytes);

    const second = await engine.apply(first.bytes, [
      {
        kind: 'updateAnnotations',
        updates: [{ id: original?.id ?? '', patch: { contents: 'Second' } }],
      },
    ]);
    const third = await engine.apply(second.bytes, [
      { kind: 'addAnnotations', annotations: [input({ kind: 'underline', quads: [QUAD] })] },
    ]);

    const annotations = await engine.readAnnotations(third.bytes);
    expect(annotations).toHaveLength(2);
    expect(annotations[0]?.contents).toBe('Second');
    expect(annotations[0]?.id).toBe(original?.id);
  });
});
