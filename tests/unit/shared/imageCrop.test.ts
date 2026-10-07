import { describe, expect, it } from 'vitest';
import { inflateSync } from 'node:zlib';
import { PDFDocument, PDFName, type PDFRef } from 'pdf-lib';
import { resourcesOf } from '../../../src/pdf/content/pageContent';
import { cropImagePixels } from '../../../src/pdf/mutate/imageCrop';
import type { ImageCodec, Raster } from '../../../src/pdf/optimize/pixels';

/**
 * Cutting a picture down to its crop, for good.
 *
 * The usual crop is a clip, which hides pixels and keeps them. This one
 * throws them away: the picture that comes out holds only what showed.
 */

const RED = [255, 0, 0];
const BLUE = [0, 0, 255];
const GREEN = [0, 255, 0];
const WHITE = [255, 255, 255];

/**
 * Four by two: the top row red then blue, the bottom row green then white,
 * two pixels of each.
 */
function samples(): Uint8Array {
  const top = [RED, RED, BLUE, BLUE];
  const bottom = [GREEN, GREEN, WHITE, WHITE];
  return Uint8Array.from([...top, ...bottom].flat());
}

async function documentWith(
  options: { filter?: 'jpeg'; alpha?: Uint8Array } = {},
): Promise<PDFDocument> {
  const document = await PDFDocument.create();
  const page = document.addPage([612, 792]);
  const entries: Record<string, unknown> = {
    Type: 'XObject',
    Subtype: 'Image',
    Width: 4,
    Height: 2,
    ColorSpace: 'DeviceRGB',
    BitsPerComponent: 8,
  };
  if (options.filter === 'jpeg') entries['Filter'] = 'DCTDecode';
  if (options.alpha !== undefined) {
    const mask = document.context.stream(options.alpha, {
      Type: 'XObject',
      Subtype: 'Image',
      Width: 4,
      Height: 2,
      ColorSpace: 'DeviceGray',
      BitsPerComponent: 8,
    });
    entries['SMask'] = document.context.register(mask);
  }
  const bytes = options.filter === 'jpeg' ? Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]) : samples();
  const image: PDFRef = document.context.register(document.context.stream(bytes, entries as never));
  page.node.setXObject(PDFName.of('Im0'), image);
  return document;
}

/** The pixels of a PNG this module wrote: stored, unfiltered rows. */
function readPng(bytes: Uint8Array): {
  width: number;
  height: number;
  type: number;
  rows: number[][];
} {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  const type = bytes[25] ?? 0;
  let offset = 8;
  const data: Uint8Array[] = [];
  while (offset < bytes.length) {
    const length = view.getUint32(offset);
    const name = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (name === 'IDAT') data.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(data));
  const channels = type === 6 ? 4 : type === 4 ? 2 : type === 2 ? 3 : 1;
  const rows: number[][] = [];
  for (let row = 0; row < height; row += 1) {
    const start = row * (width * channels + 1) + 1;
    rows.push([...raw.subarray(start, start + width * channels)]);
  }
  return { width, height, type, rows };
}

describe('cutting a picture down to its crop', () => {
  it('keeps exactly the pixels the crop shows', async () => {
    const document = await documentWith();
    // The right half of the top row: x from 0.5, y (from the bottom) from 0.5.
    const result = cropImagePixels(
      document,
      resourcesOf(document, document.getPage(0)),
      'Im0',
      { x: 0.5, y: 0.5, width: 0.5, height: 0.5 },
      null,
    );

    const png = readPng(result.bytes);
    expect(png.width).toBe(2);
    expect(png.height).toBe(1);
    expect(png.rows[0]).toEqual([...BLUE, ...BLUE]);
    expect(result.crop).toEqual({ x: 0.5, y: 0.5, width: 0.5, height: 0.5 });
  });

  it('rounds the crop out to whole pixels, and says where it ended up', async () => {
    const document = await documentWith();
    const result = cropImagePixels(
      document,
      resourcesOf(document, document.getPage(0)),
      'Im0',
      { x: 0.3, y: 0, width: 0.3, height: 0.4 },
      null,
    );

    // 0.3 of four pixels starts inside the second; 0.6 ends inside the third.
    const png = readPng(result.bytes);
    expect(png.width).toBe(2);
    expect(png.height).toBe(1);
    expect(png.rows[0]).toEqual([...GREEN, ...WHITE]);
    expect(result.crop).toEqual({ x: 0.25, y: 0, width: 0.5, height: 0.5 });
  });

  it('keeps the transparency the picture carries', async () => {
    const document = await documentWith({
      alpha: Uint8Array.from([0, 50, 100, 150, 200, 250, 255, 255]),
    });
    const result = cropImagePixels(
      document,
      resourcesOf(document, document.getPage(0)),
      'Im0',
      { x: 0, y: 0.5, width: 0.5, height: 0.5 },
      null,
    );

    const png = readPng(result.bytes);
    expect(png.type).toBe(6);
    expect(png.rows[0]).toEqual([...RED, 0, ...RED, 50]);
  });

  it('decodes a JPEG through the codec it is given', async () => {
    const document = await documentWith({ filter: 'jpeg' });
    const decoded: Raster = { width: 4, height: 2, channels: 3, samples: samples() };
    const codec: ImageCodec = {
      decodeJpeg: () => decoded,
      encodeJpeg: (raster) =>
        Uint8Array.from([0xff, 0xd8, raster.width, raster.height, 0xff, 0xd9]),
    };

    const result = cropImagePixels(
      document,
      resourcesOf(document, document.getPage(0)),
      'Im0',
      { x: 0, y: 0, width: 0.5, height: 1 },
      codec,
    );
    // Two across and two down, back out as a JPEG.
    expect([...result.bytes]).toEqual([0xff, 0xd8, 2, 2, 0xff, 0xd9]);
  });

  it('says plainly when it cannot read the picture', async () => {
    const document = await documentWith({ filter: 'jpeg' });
    expect(() =>
      cropImagePixels(
        document,
        resourcesOf(document, document.getPage(0)),
        'Im0',
        { x: 0, y: 0, width: 0.5, height: 1 },
        null,
      ),
    ).toThrow(/cannot cut/i);
  });
});
