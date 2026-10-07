import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { PdfLibMutationEngine } from '../../../src/pdf/mutate/pdfLibEngine';
import { imageIdOf, readPageWithImages } from '../../../src/pdf/mutate/images';
import type { PageContent } from '../../../src/pdf/content/pageContent';
import type { StagedAsset } from '../../../src/pdf/mutate/types';
import { buildPdf } from '../../fixtures/pdf';
import { pngPixel } from '../../fixtures/images';

/**
 * An image drawn with its own clip, and the images PaperForge adds itself.
 *
 * A cropped picture is a `q … re W n … cm /Im Do Q` group: the clip and the
 * picture belong together, so moving one has to move the other. And an image
 * PaperForge put on the page keeps one name for as long as it is there, however
 * the rest of the page changes around it.
 */

const engine = new PdfLibMutationEngine();

async function pageOf(bytes: Uint8Array): Promise<PageContent> {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  return readPageWithImages(document, 0);
}

function contentOf(page: PageContent): string {
  return new TextDecoder('latin1').decode(page.bytes);
}

/** An image clipped to the middle of itself, and a caption drawn after it. */
function croppedImage(): Uint8Array {
  return new Uint8Array(
    buildPdf({
      pages: [
        {
          content:
            'q 150 520 100 60 re W n 200 0 0 100 100 500 cm /Im0 Do Q\n' +
            'BT /F1 12 Tf 1 0 0 1 60 100 Tm (A caption) Tj ET\n',
          image: { x: 0, y: 0, width: 1, height: 1, draw: false },
        },
      ],
    }),
  );
}

const elsewhere = {
  x: 300,
  y: 200,
  width: 200,
  height: 100,
  rotation: 0,
  flipX: false,
  flipY: false,
};

function count(haystack: string, needle: RegExp): number {
  return [...haystack.matchAll(needle)].length;
}

describe('a cropped image', () => {
  it('reads the clip drawn with it as its crop', async () => {
    const image = (await pageOf(croppedImage())).images[0];
    expect(image?.crop?.x).toBeCloseTo(0.25, 5);
    expect(image?.crop?.y).toBeCloseTo(0.2, 5);
    expect(image?.crop?.width).toBeCloseTo(0.5, 5);
    expect(image?.crop?.height).toBeCloseTo(0.6, 5);
  });

  it('takes its clip with it when it moves, and leaves none behind', async () => {
    const original = croppedImage();
    const before = await pageOf(original);
    const image = before.images[0]!;

    const result = await engine.apply(original, [
      {
        kind: 'placeImage',
        page: 1,
        imageId: imageIdOf(image),
        placement: elsewhere,
        crop: image.crop,
        opacity: 1,
        token: null,
      },
    ]);
    const after = await pageOf(result.bytes);
    const content = contentOf(after);

    // The old clip, in page space, is gone: nothing clips the moved picture to
    // where it used to be.
    expect(content).not.toContain('150 520 100 60 re');
    expect(count(content, /re\s+W\s+n/g)).toBe(1);
    expect(after.images[0]?.bounds.x).toBeCloseTo(300, 4);
    expect(after.images[0]?.crop?.x).toBeCloseTo(0.25, 4);
    expect(after.images[0]?.crop?.width).toBeCloseTo(0.5, 4);
    // The caption is untouched, and still drawn after the picture.
    expect(after.runs[0]?.text).toBe('A caption');
    expect(after.images[0]?.operationIndex).toBeLessThan(after.runs[0]?.operationIndex ?? 0);
  });

  it('shows all of itself again when the crop is taken off', async () => {
    const original = croppedImage();
    const image = (await pageOf(original)).images[0]!;

    const result = await engine.apply(original, [
      {
        kind: 'placeImage',
        page: 1,
        imageId: imageIdOf(image),
        placement: { ...elsewhere, x: 100, y: 500 },
        crop: null,
        opacity: 1,
        token: null,
      },
    ]);
    const after = await pageOf(result.bytes);

    expect(contentOf(after)).not.toMatch(/re\s+W\s+n/);
    expect(after.images[0]?.crop).toBeNull();
  });

  it('does not wrap itself one level deeper with every change', async () => {
    let bytes = croppedImage();
    for (const x of [120, 140, 160]) {
      const image = (await pageOf(bytes)).images[0]!;
      bytes = (
        await engine.apply(bytes, [
          {
            kind: 'placeImage',
            page: 1,
            imageId: imageIdOf(image),
            placement: { ...elsewhere, x },
            crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
            opacity: 0.5,
            token: null,
          },
        ])
      ).bytes;
    }
    const content = contentOf(await pageOf(bytes));

    expect(count(content, /(^|\s)q\s/g)).toBe(1);
    expect(count(content, /re\s+W\s+n/g)).toBe(1);
    expect(count(content, /\sgs\s/g)).toBe(1);
  });

  it('goes back to solid when the transparency is taken off', async () => {
    const original = croppedImage();
    const image = (await pageOf(original)).images[0]!;
    const faded = await engine.apply(original, [
      {
        kind: 'placeImage',
        page: 1,
        imageId: imageIdOf(image),
        placement: elsewhere,
        crop: null,
        opacity: 0.4,
        token: null,
      },
    ]);
    const fadedImage = (await pageOf(faded.bytes)).images[0]!;
    const solid = await engine.apply(faded.bytes, [
      {
        kind: 'placeImage',
        page: 1,
        imageId: imageIdOf(fadedImage),
        placement: elsewhere,
        crop: null,
        opacity: 1,
        token: null,
      },
    ]);

    // Nothing left over from the faded drawing still fades it.
    expect(contentOf(await pageOf(solid.bytes))).not.toContain('/PFAlpha40 gs');
    expect((await pageOf(solid.bytes)).images[0]?.opacity).toBe(1);
  });

  it('leaves a clip it shares with other drawing where it is', async () => {
    // The clip also cuts the square drawn beside the picture, so it is the
    // page's, not the picture's, and must stay for the square's sake.
    const bytes = new Uint8Array(
      buildPdf({
        pages: [
          {
            content:
              'q 150 520 100 60 re W n 0 0 1 rg 150 520 20 20 re f ' +
              '200 0 0 100 100 500 cm /Im0 Do Q\n',
            image: { x: 0, y: 0, width: 1, height: 1, draw: false },
          },
        ],
      }),
    );
    const image = (await pageOf(bytes)).images[0]!;

    const result = await engine.apply(bytes, [
      {
        kind: 'placeImage',
        page: 1,
        imageId: imageIdOf(image),
        placement: elsewhere,
        crop: null,
        opacity: 1,
        token: null,
      },
    ]);
    const content = contentOf(await pageOf(result.bytes));

    expect(content).toContain('150 520 100 60 re W n');
    expect(content).toContain('150 520 20 20 re f');
  });
});

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

function blankPage(): Uint8Array {
  return new Uint8Array(buildPdf({ pages: [{ text: 'a page' }] }));
}

describe('an image PaperForge adds', () => {
  it('is marked as PaperForge’s, under the name it was given', async () => {
    const result = await engine.apply(
      blankPage(),
      [{ kind: 'addImage', page: 1, token: 'token', placement, opacity: 1, imageId: 'pf-abc123' }],
      staged,
    );
    const after = await pageOf(result.bytes);

    expect(contentOf(after)).toMatch(/\/PFImage\s*<<\s*\/PFId\s*\(pf-abc123\)\s*>>\s*BDC/);
    expect(after.images.map(imageIdOf)).toEqual(['pf-abc123']);
  });

  it('keeps that name when it is moved, cropped and replaced', async () => {
    let bytes = (
      await engine.apply(
        blankPage(),
        [{ kind: 'addImage', page: 1, token: 'token', placement, opacity: 1, imageId: 'pf-keep' }],
        staged,
      )
    ).bytes;

    for (const change of [
      { placement: { ...placement, x: 90 }, crop: null, token: null },
      { placement, crop: { x: 0.2, y: 0, width: 0.6, height: 1 }, token: null },
      { placement, crop: null, token: 'token' },
    ]) {
      bytes = (
        await engine.apply(
          bytes,
          [{ kind: 'placeImage', page: 1, imageId: 'pf-keep', opacity: 1, ...change }],
          staged,
        )
      ).bytes;
    }

    const after = await pageOf(bytes);
    expect(after.images.map(imageIdOf)).toEqual(['pf-keep']);
    expect(count(contentOf(after), /BDC/g)).toBe(1);
  });

  it('keeps that name when something drawn before it goes', async () => {
    const withPicture = new Uint8Array(
      buildPdf({ pages: [{ text: 'a page', image: { x: 10, y: 10, width: 50, height: 50 } }] }),
    );
    const added = (
      await engine.apply(
        withPicture,
        [{ kind: 'addImage', page: 1, token: 'token', placement, opacity: 1, imageId: 'pf-late' }],
        staged,
      )
    ).bytes;
    const [first] = (await pageOf(added)).images;

    const result = await engine.apply(added, [
      { kind: 'deleteImage', page: 1, imageId: imageIdOf(first!) },
    ]);
    expect((await pageOf(result.bytes)).images.map(imageIdOf)).toEqual(['pf-late']);
  });

  it('takes its marking with it when it is deleted', async () => {
    const added = (
      await engine.apply(
        blankPage(),
        [{ kind: 'addImage', page: 1, token: 'token', placement, opacity: 1, imageId: 'pf-gone' }],
        staged,
      )
    ).bytes;

    const result = await engine.apply(added, [
      { kind: 'deleteImage', page: 1, imageId: 'pf-gone' },
    ]);
    const content = contentOf(await pageOf(result.bytes));

    expect(content).not.toContain('PFImage');
    expect(content).not.toContain('EMC');
  });

  it('refuses a name the page already uses', async () => {
    const added = (
      await engine.apply(
        blankPage(),
        [{ kind: 'addImage', page: 1, token: 'token', placement, opacity: 1, imageId: 'pf-twice' }],
        staged,
      )
    ).bytes;

    await expect(
      engine.apply(
        added,
        [{ kind: 'addImage', page: 1, token: 'token', placement, opacity: 1, imageId: 'pf-twice' }],
        staged,
      ),
    ).rejects.toThrow(/already/i);
  });
});
