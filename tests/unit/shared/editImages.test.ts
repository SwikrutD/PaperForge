import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { PdfLibMutationEngine } from '../../../src/pdf/mutate/pdfLibEngine';
import { imageIdOf, readPageWithImages } from '../../../src/pdf/mutate/images';
import { exportImage, isAddedImage } from '../../../src/pdf/mutate/imageResources';
import { resourcesOf, type PageContent } from '../../../src/pdf/content/pageContent';
import { placementMatrix, placementOf } from '../../../src/pdf/content/images';
import { applyMatrix } from '../../../src/pdf/content/state';
import type { StagedAsset } from '../../../src/pdf/mutate/types';
import { buildPdf, type PdfSpec } from '../../fixtures/pdf';
import { pngPixel } from '../../fixtures/images';

/**
 * Moving, turning, cropping, replacing and removing the images a page draws.
 *
 * Each case reads the page back afterwards: an image that has moved must be
 * where it was put, and everything else on the page must be where it was.
 */

const engine = new PdfLibMutationEngine();

function documentOf(spec: PdfSpec): Uint8Array {
  return new Uint8Array(buildPdf(spec));
}

async function pageOf(bytes: Uint8Array): Promise<PageContent> {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  return readPageWithImages(document, 0);
}

/** A page with one image in a box, and a line of text under it. */
function withImage(): Uint8Array {
  return documentOf({
    pages: [
      {
        text: 'A caption',
        image: { pixels: { width: 8, height: 4 }, x: 100, y: 500, width: 200, height: 100 },
      },
    ],
  });
}

const staged = new Map<string, StagedAsset>([
  ['token', { kind: 'image', bytes: pngPixel(10, 10), format: 'png', width: 10, height: 10 }],
]);

const placement = {
  x: 50,
  y: 300,
  width: 120,
  height: 60,
  rotation: 0,
  flipX: false,
  flipY: false,
};

describe('reading the images a page draws', () => {
  it('finds one, with the box it occupies and the pixels it holds', async () => {
    const content = await pageOf(withImage());

    expect(content.images).toHaveLength(1);
    const image = content.images[0];
    expect(image?.bounds).toEqual({ x: 100, y: 500, width: 200, height: 100 });
    expect(image?.facts.width).toBe(8);
    expect(image?.facts.height).toBe(4);
    expect(image?.rotation).toBe(0);
  });

  it('reads the transform a page turned it with', async () => {
    const bytes = documentOf({
      pages: [
        {
          image: { x: 0, y: 0, width: 1, height: 1, matrix: [0, 100, -200, 0, 300, 400] },
        },
      ],
    });

    const image = (await pageOf(bytes)).images[0];
    expect(image?.rotation).toBe(90);
    expect(image?.bounds.width).toBeCloseTo(200, 5);
    expect(image?.bounds.height).toBeCloseTo(100, 5);
  });

  it('does not mistake a form for a picture', async () => {
    const bytes = documentOf({ pages: [{ text: 'no images here' }] });
    expect((await pageOf(bytes)).images).toHaveLength(0);
  });
});

describe('moving an image', () => {
  it('puts it where it was asked for, and leaves the text alone', async () => {
    const original = withImage();
    const before = await pageOf(original);
    const id = imageIdOf(before.images[0]!);

    const result = await engine.apply(original, [
      { kind: 'placeImage', page: 1, imageId: id, placement, crop: null, token: null },
    ]);
    const after = await pageOf(result.bytes);

    expect(after.images[0]?.bounds.x).toBeCloseTo(50, 4);
    expect(after.images[0]?.bounds.y).toBeCloseTo(300, 4);
    expect(after.images[0]?.bounds.width).toBeCloseTo(120, 4);
    expect(after.images[0]?.bounds.height).toBeCloseTo(60, 4);
    expect(after.runs[0]?.origin).toEqual(before.runs[0]?.origin);
  });

  it('keeps the image where the page drew it, not at the end', async () => {
    const original = withImage();
    const before = await pageOf(original);
    const id = imageIdOf(before.images[0]!);

    const result = await engine.apply(original, [
      { kind: 'placeImage', page: 1, imageId: id, placement, crop: null, token: null },
    ]);
    const after = await pageOf(result.bytes);

    // The image is still drawn before the text, so whatever covered it still
    // covers it.
    expect(after.images[0]?.operationIndex).toBeLessThan(after.runs[0]?.operationIndex ?? 0);
  });

  it('turns and mirrors it', async () => {
    const original = withImage();
    const id = imageIdOf((await pageOf(original)).images[0]!);

    const turned = await engine.apply(original, [
      {
        kind: 'placeImage',
        page: 1,
        imageId: id,
        placement: { ...placement, rotation: 90 },
        crop: null,
        token: null,
      },
    ]);
    const image = (await pageOf(turned.bytes)).images[0];

    expect(image?.rotation).toBe(90);
    // A box turned on its side is as wide as it was tall.
    expect(image?.bounds.width).toBeCloseTo(60, 4);
    expect(image?.bounds.height).toBeCloseTo(120, 4);

    const mirrored = await engine.apply(original, [
      {
        kind: 'placeImage',
        page: 1,
        imageId: id,
        placement: { ...placement, flipX: true },
        crop: null,
        token: null,
      },
    ]);
    expect((await pageOf(mirrored.bytes)).images[0]?.flippedX).toBe(true);
  });

  it('reads back the crop it wrote, so cropping twice is not cumulative', async () => {
    const original = withImage();
    const id = imageIdOf((await pageOf(original)).images[0]!);

    const result = await engine.apply(original, [
      {
        kind: 'placeImage',
        page: 1,
        imageId: id,
        placement: { ...placement, x: 100, y: 500, width: 200, height: 100 },
        crop: { x: 0.25, y: 0.1, width: 0.5, height: 0.8 },
        token: null,
      },
    ]);

    const image = (await pageOf(result.bytes)).images[0];
    expect(image?.crop?.x).toBeCloseTo(0.25, 4);
    expect(image?.crop?.y).toBeCloseTo(0.1, 4);
    expect(image?.crop?.width).toBeCloseTo(0.5, 4);
    expect(image?.crop?.height).toBeCloseTo(0.8, 4);
  });

  it('does not call the page it is drawn on a crop', async () => {
    // A clip around the whole page is the page's business, not the image's.
    const bytes = documentOf({
      pages: [
        {
          content: '0 0 612 792 re W n q 200 0 0 100 100 500 cm /Im0 Do Q\n',
          image: { x: 0, y: 0, width: 1, height: 1, matrix: [1, 0, 0, 1, -9000, -9000] },
        },
      ],
    });

    const images = (await pageOf(bytes)).images;
    expect(images).toHaveLength(2);
    expect(images[1]?.crop).toBeNull();
  });

  it('crops it by clipping, without touching the image itself', async () => {
    const original = withImage();
    const id = imageIdOf((await pageOf(original)).images[0]!);

    const result = await engine.apply(original, [
      {
        kind: 'placeImage',
        page: 1,
        imageId: id,
        placement,
        crop: { x: 0.25, y: 0, width: 0.5, height: 1 },
        token: null,
      },
    ]);

    const content = new TextDecoder('latin1').decode((await pageOf(result.bytes)).bytes);
    expect(content).toContain('re W n');
    // The picture itself still has all its pixels.
    expect((await pageOf(result.bytes)).images[0]?.facts.width).toBe(8);
  });

  it('refuses a page that draws it in a way it cannot undo', async () => {
    // A transform that flattens everything onto a line cannot be inverted.
    const bytes = documentOf({
      pages: [
        {
          image: { x: 0, y: 0, width: 1, height: 1, matrix: [0, 0, 0, 0, 100, 100] },
        },
      ],
    });
    const id = imageIdOf((await pageOf(bytes)).images[0]!);

    await expect(
      engine.apply(bytes, [
        { kind: 'placeImage', page: 1, imageId: id, placement, crop: null, token: null },
      ]),
    ).rejects.toThrow(/cannot undo/i);
  });
});

describe('replacing and removing', () => {
  it('draws a different picture in the same box', async () => {
    const original = withImage();
    const id = imageIdOf((await pageOf(original)).images[0]!);

    const result = await engine.apply(
      original,
      [
        {
          kind: 'placeImage',
          page: 1,
          imageId: id,
          placement: {
            x: 100,
            y: 500,
            width: 200,
            height: 100,
            rotation: 0,
            flipX: false,
            flipY: false,
          },
          crop: null,
          token: 'token',
        },
      ],
      staged,
    );

    const image = (await pageOf(result.bytes)).images[0];
    expect(isAddedImage(image?.resourceName ?? '')).toBe(true);
    expect(image?.facts.width).toBe(10);
    expect(image?.bounds).toEqual({ x: 100, y: 500, width: 200, height: 100 });
  });

  it('takes an image off the page and leaves the rest', async () => {
    const original = withImage();
    const before = await pageOf(original);
    const id = imageIdOf(before.images[0]!);

    const result = await engine.apply(original, [{ kind: 'deleteImage', page: 1, imageId: id }]);
    const after = await pageOf(result.bytes);

    expect(after.images).toHaveLength(0);
    expect(after.runs[0]?.text).toBe('A caption');
  });

  it('refuses an image that is no longer there', async () => {
    await expect(
      engine.apply(withImage(), [{ kind: 'deleteImage', page: 1, imageId: 'img99' }]),
    ).rejects.toThrow(/no longer/i);
  });
});

describe('adding an image', () => {
  it('draws a staged image where it was asked for', async () => {
    const original = documentOf({ pages: [{ text: 'a page' }] });

    const result = await engine.apply(
      original,
      [{ kind: 'addImage', page: 1, token: 'token', placement }],
      staged,
    );

    const content = await pageOf(result.bytes);
    expect(content.images).toHaveLength(1);
    expect(content.images[0]?.bounds.x).toBeCloseTo(50, 4);
    expect(content.images[0]?.bounds.width).toBeCloseTo(120, 4);
    expect(isAddedImage(content.images[0]?.resourceName ?? '')).toBe(true);
  });

  it('gives each added image a name of its own', async () => {
    let bytes = documentOf({ pages: [{ text: 'a page' }] });
    for (let round = 0; round < 3; round += 1) {
      const result = await engine.apply(
        bytes,
        [{ kind: 'addImage', page: 1, token: 'token', placement }],
        staged,
      );
      bytes = result.bytes;
    }

    const names = new Set((await pageOf(bytes)).images.map((image) => image.resourceName));
    expect(names.size).toBe(3);
  });
});

describe('the placement matrix', () => {
  it('reads back the box it was built from', () => {
    for (const rotation of [0, 90, 180, 270, 37]) {
      for (const flipX of [false, true]) {
        const box = { x: 12, y: 34, width: 100, height: 50, rotation, flipX, flipY: false };
        const read = placementOf(placementMatrix(box));

        expect(read.x).toBeCloseTo(box.x, 4);
        expect(read.y).toBeCloseTo(box.y, 4);
        expect(read.width).toBeCloseTo(box.width, 4);
        expect(read.height).toBeCloseTo(box.height, 4);
        expect(read.rotation).toBeCloseTo(rotation, 2);
        expect(read.flipX).toBe(flipX);
      }
    }
  });

  it('reports mirroring the other way as the same thing turned about', () => {
    // Mirroring up-down is mirroring left-right, turned half a circle; saying
    // so keeps what is read back the same as what was written.
    const read = placementOf(
      placementMatrix({
        x: 0,
        y: 0,
        width: 80,
        height: 40,
        rotation: 0,
        flipX: false,
        flipY: true,
      }),
    );
    expect(read.flipX).toBe(true);
    expect(read.rotation).toBeCloseTo(180, 2);
  });

  it('maps the unit square onto the box asked for', () => {
    const matrix = placementMatrix({
      x: 10,
      y: 20,
      width: 100,
      height: 50,
      rotation: 0,
      flipX: false,
      flipY: false,
    });

    expect(applyMatrix(matrix, 0, 0)).toEqual({ x: 10, y: 20 });
    expect(applyMatrix(matrix, 1, 1)).toEqual({ x: 110, y: 70 });
  });

  it('mirrors without moving the box', () => {
    const matrix = placementMatrix({
      x: 10,
      y: 20,
      width: 100,
      height: 50,
      rotation: 0,
      flipX: true,
      flipY: false,
    });

    const left = applyMatrix(matrix, 0, 0);
    const right = applyMatrix(matrix, 1, 0);
    expect(left.x).toBeCloseTo(110, 5);
    expect(right.x).toBeCloseTo(10, 5);
  });
});

describe('writing an image out', () => {
  it('turns the samples a page holds into a PNG', async () => {
    const document = await PDFDocument.load(withImage(), { updateMetadata: false });
    const exported = exportImage(document, resourcesOf(document, document.getPage(0)), 'Im0');

    expect(exported.extension).toBe('png');
    expect([...exported.bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    // The header says how big the picture is.
    const view = new DataView(exported.bytes.buffer, exported.bytes.byteOffset);
    expect(view.getUint32(16)).toBe(8);
    expect(view.getUint32(20)).toBe(4);
  });

  it('says plainly when it cannot write one out', async () => {
    const document = await PDFDocument.load(withImage(), { updateMetadata: false });
    expect(() =>
      exportImage(document, resourcesOf(document, document.getPage(0)), 'Missing'),
    ).toThrow(/no longer on the page/i);
  });
});
