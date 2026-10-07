import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { PdfLibMutationEngine } from '../../../src/pdf/mutate/pdfLibEngine';
import { imageIdOf, pictureSource, readPageWithImages } from '../../../src/pdf/mutate/images';
import { exportImage } from '../../../src/pdf/mutate/imageResources';
import type { ImagePlacement } from '../../../src/pdf/content/images';
import type { StagedAsset } from '../../../src/pdf/mutate/types';
import { buildFormPdf } from '../../fixtures/formImages';
import { pngPixel } from '../../fixtures/images';

/**
 * Inline images: `BI <dictionary> ID <samples> EI`, written straight into the
 * content stream. Scanners and older producers use them for small pictures;
 * they are found, moved, cropped, deleted, replaced and exported like any
 * other picture, and their samples are carried byte for byte.
 */

const engine = new PdfLibMutationEngine();

/** Two by two RGB pixels, with bytes above 0x7f that a text round trip would spoil. */
const SAMPLES = [0xff, 0x00, 0x80, 0x9f, 0x10, 0x20, 0x85, 0x96, 0xa0, 0x00, 0xff, 0x00];
const RAW = String.fromCharCode(...SAMPLES);

function inlinePage(
  content = `q 120 0 0 60 100 200 cm BI /W 2 /H 2 /CS /RGB /BPC 8 ID ${RAW} EI Q`,
): Promise<Uint8Array> {
  return buildFormPdf({ forms: {}, pages: [{ content, xobjects: {} }] });
}

async function imagesOn(bytes: Uint8Array): Promise<ImagePlacement[]> {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  return (await readPageWithImages(document, 0)).images;
}

function contentOf(bytes: Uint8Array): Promise<Uint8Array> {
  return PDFDocument.load(bytes).then(async (document) => {
    return (await readPageWithImages(document, 0)).bytes;
  });
}

function includes(haystack: Uint8Array, needle: readonly number[]): boolean {
  outer: for (let index = 0; index + needle.length <= haystack.length; index += 1) {
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[index + offset] !== needle[offset]) continue outer;
    }
    return true;
  }
  return false;
}

const box = { rotation: 0, flipX: false, flipY: false };

describe('an inline image', () => {
  it('is found, with its size on the page and in pixels', async () => {
    const [image, ...rest] = await imagesOn(await inlinePage());

    expect(rest).toHaveLength(0);
    expect(image?.kind).toBe('inline');
    expect(image?.bounds).toEqual({ x: 100, y: 200, width: 120, height: 60 });
    expect(image?.facts.width).toBe(2);
    expect(image?.facts.height).toBe(2);
    expect(Array.from(image?.inline?.data.subarray(0, SAMPLES.length) ?? [])).toEqual(SAMPLES);
  });

  it('moves, keeping its samples byte for byte', async () => {
    const original = await inlinePage();
    const [image] = await imagesOn(original);

    const result = await engine.apply(original, [
      {
        kind: 'placeImage',
        page: 1,
        imageId: imageIdOf(image!),
        placement: { x: 300, y: 400, width: 60, height: 30, ...box },
        crop: { x: 0, y: 0, width: 0.5, height: 1 },
        opacity: 1,
        token: null,
      },
    ]);
    const [after, ...rest] = await imagesOn(result.bytes);

    expect(rest).toHaveLength(0);
    expect(after?.kind).toBe('inline');
    expect(after?.bounds.x).toBeCloseTo(300, 4);
    expect(after?.bounds.y).toBeCloseTo(400, 4);
    expect(after?.crop?.width).toBeCloseTo(0.5, 4);
    expect(includes(await contentOf(result.bytes), SAMPLES)).toBe(true);
  });

  it('can be deleted', async () => {
    const original = await inlinePage(
      `q 120 0 0 60 100 200 cm BI /W 2 /H 2 /CS /RGB /BPC 8 ID ${RAW} EI Q BT ET`,
    );
    const [image] = await imagesOn(original);
    const result = await engine.apply(original, [
      { kind: 'deleteImage', page: 1, imageId: imageIdOf(image!) },
    ]);

    expect(await imagesOn(result.bytes)).toHaveLength(0);
    expect(includes(await contentOf(result.bytes), SAMPLES)).toBe(false);
  });

  it('becomes an ordinary picture when replaced', async () => {
    const original = await inlinePage();
    const [image] = await imagesOn(original);
    const assets = new Map<string, StagedAsset>([
      ['tok', { kind: 'image', bytes: pngPixel(5, 3), format: 'png', width: 5, height: 3 }],
    ]);
    const result = await engine.apply(
      original,
      [
        {
          kind: 'placeImage',
          page: 1,
          imageId: imageIdOf(image!),
          placement: { x: 100, y: 200, width: 120, height: 60, ...box },
          crop: null,
          opacity: 1,
          token: 'tok',
        },
      ],
      assets,
    );
    const [after] = await imagesOn(result.bytes);
    expect(after?.kind).toBe('xobject');
    expect(after?.facts.width).toBe(5);
  });

  it('exports as a PNG of its samples, through its filters', async () => {
    // The same samples, hex-encoded, the filter spelled short.
    const hex = SAMPLES.map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const bytes = await inlinePage(
      `q 120 0 0 60 100 200 cm BI /W 2 /H 2 /CS /RGB /BPC 8 /F /AHx ID ${hex}> EI Q`,
    );
    const document = await PDFDocument.load(bytes);
    const [image] = (await readPageWithImages(document, 0)).images;
    const source = pictureSource(document, 0, image!);
    const exported = exportImage(document, source.resources, source.resourceName);

    expect(exported.extension).toBe('png');
    // A PNG of 2 × 2 pixels.
    const view = new DataView(exported.bytes.buffer, exported.bytes.byteOffset);
    expect(view.getUint32(16)).toBe(2);
    expect(view.getUint32(20)).toBe(2);
  });

  it('is found inside a form, too', async () => {
    const bytes = await buildFormPdf({
      forms: {
        Scan: { content: `q 50 0 0 50 0 0 cm BI /W 2 /H 2 /CS /RGB /BPC 8 ID ${RAW} EI Q` },
      },
      pages: [{ content: '1 0 0 1 10 10 cm /Fm0 Do', xobjects: { Fm0: 'Scan' } }],
    });
    const [image] = await imagesOn(bytes);
    expect(image?.kind).toBe('inline');
    expect(image?.bounds.x).toBeCloseTo(10, 5);
    expect(image?.forms).toHaveLength(1);
  });
});
