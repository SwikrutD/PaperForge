import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { PdfLibMutationEngine } from '../../../src/pdf/mutate/pdfLibEngine';
import { formUsesOf, imageIdOf, readPageWithImages } from '../../../src/pdf/mutate/images';
import type { ImagePlacement } from '../../../src/pdf/content/images';
import type { StagedAsset } from '../../../src/pdf/mutate/types';
import type { EditOperation } from '../../../src/shared/schemas/edit';
import { buildFormPdf, logoInForm } from '../../fixtures/formImages';
import { pngPixel } from '../../fixtures/images';

/**
 * Pictures drawn from inside form XObjects.
 *
 * The picture is found by walking into the form with the transform in force
 * where the page draws it, times the form's own `/Matrix`, and is edited in
 * the form's content stream. A form drawn more than once is copied first when
 * only this drawing of it is to change.
 */

const engine = new PdfLibMutationEngine();

async function imagesOn(bytes: Uint8Array, page = 0): Promise<ImagePlacement[]> {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  return (await readPageWithImages(document, page)).images;
}

const box = { rotation: 0, flipX: false, flipY: false };

function place(
  image: ImagePlacement,
  placement: { x: number; y: number; width: number; height: number },
  scope?: 'this' | 'all',
): Extract<EditOperation, { kind: 'placeImage' }> {
  return {
    kind: 'placeImage' as const,
    page: 1,
    imageId: imageIdOf(image),
    placement: { ...placement, ...box },
    crop: null,
    opacity: 1,
    token: null,
    ...(scope === undefined ? {} : { scope }),
  };
}

describe('pictures inside a form XObject', () => {
  it('are found, placed by the page transform times the form matrix', async () => {
    const [image, ...rest] = await imagesOn(await logoInForm());

    expect(rest).toHaveLength(0);
    expect(image?.resourceName).toBe('Im0');
    expect(image?.bounds.x).toBeCloseTo(50, 5);
    expect(image?.bounds.y).toBeCloseTo(60, 5);
    expect(image?.bounds.width).toBeCloseTo(100, 5);
    expect(image?.bounds.height).toBeCloseTo(50, 5);
    expect(image?.forms.map((step) => step.resourceName)).toEqual(['Fm0']);
    expect(image?.facts.width).toBe(4);
  });

  it('are found through forms inside forms, each with its own matrix', async () => {
    const bytes = await buildFormPdf({
      forms: {
        Outer: { content: '/Inner Do', matrix: [2, 0, 0, 2, 0, 0], xobjects: { Inner: 'Inner' } },
        Inner: {
          content: 'q 10 0 0 10 0 0 cm /Pic Do Q',
          matrix: [1, 0, 0, 1, 5, 5],
          xobjects: { Pic: 'image' },
        },
      },
      pages: [{ content: '1 0 0 1 100 100 cm /Fm0 Do', xobjects: { Fm0: 'Outer' } }],
    });
    const [image] = await imagesOn(bytes);

    // (0,0) of the picture is (5,5) in Outer, (10,10) on the way out of it,
    // and (110,110) on the page; it is 10 × 2 across.
    expect(image?.bounds.x).toBeCloseTo(110, 5);
    expect(image?.bounds.y).toBeCloseTo(110, 5);
    expect(image?.bounds.width).toBeCloseTo(20, 5);
    expect(image?.forms.map((step) => step.resourceName)).toEqual(['Fm0', 'Inner']);
    expect(imageIdOf(image!)).not.toBe(imageIdOf({ ...image!, forms: [] }));
  });

  it('use the resources of whatever draws a form that has none of its own', async () => {
    const bytes = await buildFormPdf({
      forms: { Bare: { content: '50 0 0 50 0 0 cm /Im0 Do', noResources: true } },
      pages: [{ content: '/Fm0 Do', xobjects: { Fm0: 'Bare', Im0: 'image' } }],
    });
    expect(await imagesOn(bytes)).toHaveLength(1);
  });

  it('do not loop forever on a form that draws itself', async () => {
    const bytes = await buildFormPdf({
      forms: {
        Loop: {
          content: '/Self Do q 10 0 0 10 0 0 cm /Pic Do Q',
          xobjects: { Self: 'Loop', Pic: 'image' },
        },
      },
      pages: [{ content: '/Fm0 Do', xobjects: { Fm0: 'Loop' } }],
    });
    const images = await imagesOn(bytes);
    expect(images.length).toBeGreaterThan(0);
    expect(images.length).toBeLessThan(20);
  });

  it('move inside the form, leaving the page drawing the same form', async () => {
    const original = await logoInForm();
    const [image] = await imagesOn(original);

    const result = await engine.apply(original, [
      place(image!, { x: 300, y: 400, width: 80, height: 40 }),
    ]);
    const [after] = await imagesOn(result.bytes);

    expect(after?.bounds.x).toBeCloseTo(300, 4);
    expect(after?.bounds.y).toBeCloseTo(400, 4);
    expect(after?.bounds.width).toBeCloseTo(80, 4);
    expect(after?.forms.map((step) => step.resourceName)).toEqual(['Fm0']);
  });

  it('grow the form box when the picture is moved past its edge', async () => {
    // The form clips to its /BBox (0 0 200 100); a picture moved outside it
    // would vanish unless the box grows to take it in.
    const original = await logoInForm();
    const [image] = await imagesOn(original);
    const result = await engine.apply(original, [
      place(image!, { x: 400, y: 600, width: 100, height: 50 }),
    ]);

    const document = await PDFDocument.load(result.bytes);
    const [after] = (await readPageWithImages(document, 0)).images;
    expect(after?.bounds.x).toBeCloseTo(400, 4);
    expect(after?.formClip).not.toBeNull();
    expect(after!.formClip!.x + after!.formClip!.width).toBeGreaterThanOrEqual(500 - 1e-6);
    expect(after!.formClip!.y + after!.formClip!.height).toBeGreaterThanOrEqual(650 - 1e-6);
  });

  it('can be deleted from inside the form', async () => {
    const original = await logoInForm();
    const [image] = await imagesOn(original);
    const result = await engine.apply(original, [
      { kind: 'deleteImage', page: 1, imageId: imageIdOf(image!) },
    ]);
    expect(await imagesOn(result.bytes)).toHaveLength(0);
  });

  it('can be replaced, the new picture going into the form', async () => {
    const original = await logoInForm();
    const [image] = await imagesOn(original);
    const assets = new Map<string, StagedAsset>([
      ['tok', { kind: 'image', bytes: pngPixel(9, 7), format: 'png', width: 9, height: 7 }],
    ]);
    const result = await engine.apply(
      original,
      [{ ...place(image!, { x: 50, y: 60, width: 100, height: 50 }), token: 'tok' }],
      assets,
    );
    const [after] = await imagesOn(result.bytes);
    expect(after?.facts.width).toBe(9);
    expect(after?.forms).toHaveLength(1);
  });
});

describe('a form drawn more than once', () => {
  async function twiceOnOnePage(): Promise<Uint8Array> {
    return buildFormPdf({
      forms: {
        Logo: { content: 'q 100 0 0 50 0 0 cm /Im0 Do Q', xobjects: { Im0: 'image' } },
      },
      pages: [
        {
          content: 'q 1 0 0 1 0 0 cm /Fm0 Do Q q 1 0 0 1 0 300 cm /Fm0 Do Q',
          xobjects: { Fm0: 'Logo' },
        },
      ],
    });
  }

  it('says how many times the form is drawn', async () => {
    const document = await PDFDocument.load(await twiceOnOnePage());
    const images = (await readPageWithImages(document, 0)).images;
    const uses = formUsesOf(document);

    expect(images).toHaveLength(2);
    for (const image of images) {
      expect(Math.max(...image.forms.map((step) => uses.get(step.ref ?? '') ?? 0))).toBe(2);
    }
  });

  it('changes only this drawing when asked to, by copying the form', async () => {
    const original = await twiceOnOnePage();
    const [, upper] = await imagesOn(original);
    expect(upper?.bounds.y).toBeCloseTo(300, 4);

    const result = await engine.apply(original, [
      place(upper!, { x: 200, y: 350, width: 100, height: 50 }, 'this'),
    ]);
    const after = (await imagesOn(result.bytes)).map((image) => image.bounds);

    expect(after).toHaveLength(2);
    expect(after[0]?.x).toBeCloseTo(0, 4);
    expect(after[0]?.y).toBeCloseTo(0, 4);
    expect(after[1]?.x).toBeCloseTo(200, 4);
    expect(after[1]?.y).toBeCloseTo(350, 4);

    const document = await PDFDocument.load(result.bytes);
    expect(Math.max(...formUsesOf(document).values())).toBe(1);
  });

  it('changes every drawing alike when asked to', async () => {
    const original = await twiceOnOnePage();
    const [, upper] = await imagesOn(original);

    const result = await engine.apply(original, [
      place(upper!, { x: 200, y: 350, width: 100, height: 50 }, 'all'),
    ]);
    const after = (await imagesOn(result.bytes)).map((image) => image.bounds);

    // The same move, made in the form, shows at both places it is drawn.
    expect(after[0]?.x).toBeCloseTo(200, 4);
    expect(after[0]?.y).toBeCloseTo(50, 4);
    expect(after[1]?.x).toBeCloseTo(200, 4);
    expect(after[1]?.y).toBeCloseTo(350, 4);
  });

  it('leaves other pages alone when only this one is changed', async () => {
    const original = await buildFormPdf({
      forms: { Logo: { content: 'q 100 0 0 50 0 0 cm /Im0 Do Q', xobjects: { Im0: 'image' } } },
      pages: [
        { content: '/Fm0 Do', xobjects: { Fm0: 'Logo' } },
        { content: '/Fm0 Do', xobjects: { Fm0: 'Logo' } },
      ],
    });
    const [image] = await imagesOn(original, 0);

    const result = await engine.apply(original, [
      { kind: 'deleteImage', page: 1, imageId: imageIdOf(image!), scope: 'this' },
    ]);

    expect(await imagesOn(result.bytes, 0)).toHaveLength(0);
    expect(await imagesOn(result.bytes, 1)).toHaveLength(1);
  });
});
