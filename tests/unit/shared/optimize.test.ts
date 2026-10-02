import { describe, expect, it } from 'vitest';
import {
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  type PDFRawStream,
  type PDFRef,
  concatTransformationMatrix,
  decodePDFRawStream,
  drawObject,
  popGraphicsState,
  pushGraphicsState,
} from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { OPTIMIZE_PRESETS, type OptimizeSettings } from '../../../src/shared/schemas/optimize';
import { PdfLibMutationEngine } from '../../../src/pdf/mutate/pdfLibEngine';
import {
  downsample,
  looksPhotographic,
  toGrey,
  type ImageCodec,
  type Raster,
} from '../../../src/pdf/optimize/pixels';

/**
 * A stand-in for Chromium's JPEG codec: "JPEG" here is the samples behind a
 * small header, so a test can read back exactly what was encoded and at
 * which quality.
 */
const fakeCodec: ImageCodec = {
  decodeJpeg(bytes) {
    const text = new TextDecoder('latin1').decode(bytes.subarray(0, 32));
    const match = /^FAKEJPEG (\d+) (\d+) \d+\n/.exec(text);
    if (match === null) return null;
    const width = Number(match[1]);
    const height = Number(match[2]);
    return { width, height, channels: 3, samples: bytes.subarray(match[0].length) };
  },
  encodeJpeg(raster, quality) {
    const header = new TextEncoder().encode(
      `FAKEJPEG ${String(raster.width)} ${String(raster.height)} ${String(quality)}\n`,
    );
    const out = new Uint8Array(header.length + raster.samples.length);
    out.set(header);
    out.set(raster.samples, header.length);
    return out;
  },
};

/** Deterministic noise: a photograph as far as any heuristic can tell. */
function noise(length: number, seed = 7): Uint8Array {
  const out = new Uint8Array(length);
  let state = seed;
  for (let index = 0; index < length; index += 1) {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    out[index] = state >>> 24;
  }
  return out;
}

interface PictureSpec {
  width: number;
  height: number;
  samples: Uint8Array;
  colorSpace?: string;
  /** The picture is stored as given, uncompressed, rather than deflated. */
  raw?: boolean;
}

/**
 * One page drawing one picture at `drawn` points square, with some text drawn
 * by an uncompressed content stream.
 */
async function documentWith(
  picture: PictureSpec,
  drawn: number,
  extras: (document: PDFDocument, ref: PDFRef) => void = () => undefined,
): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const page = document.addPage([612, 792]);
  const dict = {
    Type: 'XObject',
    Subtype: 'Image',
    Width: picture.width,
    Height: picture.height,
    ColorSpace: picture.colorSpace ?? 'DeviceRGB',
    BitsPerComponent: 8,
  };
  const stream = picture.raw
    ? document.context.stream(picture.samples, dict)
    : document.context.flateStream(picture.samples, dict);
  const ref = document.context.register(stream);
  page.node.setXObject(PDFName.of('Im0'), ref);
  page.pushOperators(
    pushGraphicsState(),
    concatTransformationMatrix(drawn, 0, 0, drawn, 72, 72),
    drawObject('Im0'),
    popGraphicsState(),
  );
  extras(document, ref);
  return document.save({ useObjectStreams: false });
}

async function pictureOf(bytes: Uint8Array): Promise<PDFRawStream> {
  const document = await PDFDocument.load(bytes);
  const xobjects = document.getPage(0).node.Resources()?.lookup(PDFName.of('XObject'), PDFDict);
  return document.context.lookup(xobjects?.get(PDFName.of('Im0'))) as PDFRawStream;
}

function numberIn(stream: PDFRawStream, key: string): number {
  return stream.dict.lookup(PDFName.of(key), PDFNumber).asNumber();
}

const engine = new PdfLibMutationEngine();
const balanced = OPTIMIZE_PRESETS.balanced;

describe('picture arithmetic', () => {
  it('averages the samples each smaller pixel covers', () => {
    const raster: Raster = {
      width: 2,
      height: 2,
      channels: 1,
      samples: Uint8Array.of(0, 100, 200, 100),
    };
    expect(downsample(raster, 1, 1).samples).toEqual(Uint8Array.of(100));
    // It never enlarges.
    expect(downsample(raster, 4, 4)).toBe(raster);
  });

  it('weighs the primaries the way the eye does', () => {
    const red: Raster = { width: 1, height: 1, channels: 3, samples: Uint8Array.of(255, 0, 0) };
    expect(toGrey(red).samples).toEqual(Uint8Array.of(76));
  });

  it('tells a photograph from a drawing by how many colours it has', () => {
    const photo: Raster = { width: 128, height: 128, channels: 3, samples: noise(128 * 128 * 3) };
    const flat: Raster = {
      width: 128,
      height: 128,
      channels: 3,
      samples: new Uint8Array(128 * 128 * 3).fill(200),
    };
    expect(looksPhotographic(photo)).toBe(true);
    expect(looksPhotographic(flat)).toBe(false);
  });
});

describe('Optimize PDF', () => {
  it('makes a picture drawn far above the target resolution smaller, and stores a photograph as JPEG', async () => {
    // 1200 pixels across 100 points is 864 dpi.
    const bytes = await documentWith(
      { width: 1200, height: 1200, samples: noise(1200 * 1200 * 3) },
      100,
    );
    const result = await engine.optimize(bytes, balanced, fakeCodec);

    expect(result.report).toMatchObject({ imagesResampled: 1, imagesConverted: 1 });
    expect(result.bytes.length).toBeLessThan(bytes.length / 10);

    const picture = await pictureOf(result.bytes);
    // 150 dpi across 100 points.
    expect(numberIn(picture, 'Width')).toBe(208);
    expect(picture.dict.lookup(PDFName.of('Filter'))).toBe(PDFName.of('DCTDecode'));
    expect(new TextDecoder('latin1').decode(picture.contents.subarray(0, 20))).toMatch(
      /^FAKEJPEG 208 208 80/,
    );
  });

  it('leaves a picture alone that is already near the target resolution', async () => {
    // 300 pixels across 144 points is 150 dpi.
    const bytes = await documentWith(
      { width: 300, height: 300, samples: new Uint8Array(300 * 300 * 3).fill(90) },
      144,
    );
    const result = await engine.optimize(bytes, balanced, fakeCodec);
    expect(result.report.imagesResampled).toBe(0);
    expect(numberIn(await pictureOf(result.bytes), 'Width')).toBe(300);
  });

  it('keeps a drawing lossless when it is made smaller', async () => {
    const samples = new Uint8Array(1000 * 1000);
    for (let index = 0; index < samples.length; index += 1)
      samples[index] = index % 7 === 0 ? 0 : 255;
    const bytes = await documentWith(
      { width: 1000, height: 1000, samples, colorSpace: 'DeviceGray', raw: true },
      72,
    );
    const result = await engine.optimize(bytes, OPTIMIZE_PRESETS.small, fakeCodec);
    const picture = await pictureOf(result.bytes);
    expect(picture.dict.lookup(PDFName.of('Filter'))).toBe(PDFName.of('FlateDecode'));
    expect(picture.dict.lookup(PDFName.of('ColorSpace'))).toBe(PDFName.of('DeviceGray'));
    expect(numberIn(picture, 'Width')).toBe(96);
    expect(decodePDFRawStream(picture).decode().length).toBe(96 * 96);
  });

  it('does not shrink a picture it cannot measure, such as one in an annotation', async () => {
    const bytes = await documentWith(
      { width: 1200, height: 1200, samples: noise(1200 * 1200 * 3) },
      100,
      (document, ref) => {
        const appearance = document.context.register(
          document.context.stream('q 10 0 0 10 0 0 cm /Im0 Do Q', {
            Type: 'XObject',
            Subtype: 'Form',
            BBox: [0, 0, 10, 10],
            Resources: { XObject: { Im0: ref } },
          }),
        );
        const annotation = document.context.register(
          document.context.obj({
            Type: 'Annot',
            Subtype: 'Stamp',
            Rect: [0, 0, 10, 10],
            AP: { N: appearance },
          }),
        );
        document.getPage(0).node.addAnnot(annotation);
      },
    );
    const result = await engine.optimize(bytes, balanced, fakeCodec);
    expect(result.report.imagesResampled).toBe(0);
    expect(numberIn(await pictureOf(result.bytes), 'Width')).toBe(1200);
  });

  it('turns colour pictures grey when asked, and only pictures', async () => {
    const bytes = await documentWith(
      { width: 64, height: 64, samples: new Uint8Array(64 * 64 * 3).fill(120) },
      64,
    );
    const settings: OptimizeSettings = { ...OPTIMIZE_PRESETS.quality, grayscaleImages: true };
    const result = await engine.optimize(bytes, settings, fakeCodec);
    expect(result.report.imagesGreyed).toBe(1);
    const picture = await pictureOf(result.bytes);
    expect(picture.dict.lookup(PDFName.of('ColorSpace'))).toBe(PDFName.of('DeviceGray'));
  });

  it('leaves pictures it cannot read back exactly as they were', async () => {
    const bytes = await documentWith(
      {
        width: 1200,
        height: 1200,
        samples: noise(1200 * 1200 * 4),
        colorSpace: 'DeviceCMYK',
      },
      100,
    );
    const result = await engine.optimize(bytes, balanced, fakeCodec);
    expect(result.report.imagesResampled).toBe(0);
    expect(numberIn(await pictureOf(result.bytes), 'Width')).toBe(1200);
  });

  it('compresses uncompressed content and keeps the text readable', async () => {
    const document = await PDFDocument.create();
    const page = document.addPage([612, 792]);
    const font = await document.embedFont('Helvetica');
    const text = 'Optimised but still readable. '.repeat(40);
    const stream = document.context.stream(`BT /F1 10 Tf 40 700 Td (${text}) Tj ET\n`.repeat(4));
    page.node.set(PDFName.of('Contents'), document.context.register(stream));
    page.node.setFontDictionary(PDFName.of('F1'), font.ref);
    const bytes = await document.save({ useObjectStreams: false });

    const result = await engine.optimize(bytes, OPTIMIZE_PRESETS.quality, null);
    expect(result.report.streamsCompressed).toBeGreaterThan(0);
    expect(result.bytes.length).toBeLessThan(bytes.length);

    const task = getDocument({ data: result.bytes });
    const pdf = await task.promise;
    const content = await (await pdf.getPage(1)).getTextContent();
    expect(content.items.map((item) => ('str' in item ? item.str : '')).join('')).toContain(
      'Optimised but still readable.',
    );
    await task.destroy();
  });

  it('describes what it could act on before it is run', async () => {
    const bytes = await documentWith(
      { width: 1200, height: 1200, samples: noise(1200 * 1200 * 3) },
      100,
    );
    const analysis = await engine.analyzeForOptimize(bytes);
    expect(analysis.images).toMatchObject({ total: 1, lossless: 1, jpeg: 0, highestDpi: 864 });
    expect(analysis.pageCount).toBe(1);
  });

  it('works without a JPEG codec, doing only what needs none', async () => {
    const bytes = await documentWith(
      { width: 1200, height: 1200, samples: noise(1200 * 1200 * 3) },
      100,
    );
    const result = await engine.optimize(bytes, balanced, null);
    const picture = await pictureOf(result.bytes);
    expect(picture.dict.lookup(PDFName.of('Filter'))).toBe(PDFName.of('FlateDecode'));
    expect(numberIn(picture, 'Width')).toBe(208);
  });
});
