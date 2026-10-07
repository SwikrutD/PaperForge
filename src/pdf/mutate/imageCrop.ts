import { PDFDict, PDFName, PDFRawStream, PDFRef, type PDFDocument } from 'pdf-lib';
import { AppError } from '@shared/errors/appError';
import { describePicture, readRaster } from '../optimize/images';
import type { ImageCodec, Raster } from '../optimize/pixels';
import { encodePng } from './imageResources';

/**
 * Cutting a picture down to its crop, for good.
 *
 * A crop is normally a clip: the hidden pixels stay in the file, and the crop
 * can be taken off again. Cutting throws them away, which makes the file
 * smaller and means nobody can recover what was cropped out. The result is a
 * new picture, staged and drawn in place of the old one like any replacement,
 * so the change is undone the same way.
 *
 * Only pictures PaperForge can read exactly are cut: 8-bit grey or RGB,
 * stored plainly, deflated, or — given a codec — as JPEG. A JPEG goes back out
 * as a JPEG and anything else as a PNG, with its transparency when it has one.
 */

export interface Crop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CutPicture {
  bytes: Uint8Array;
  /** The crop as it was cut: rounded out to whole pixels. */
  crop: Crop;
}

/** How good a cut JPEG is: high, because it has already been compressed once. */
const JPEG_QUALITY = 92;

export function cropImagePixels(
  document: PDFDocument,
  resources: PDFDict | undefined,
  resourceName: string,
  crop: Crop,
  codec: ImageCodec | null,
): CutPicture {
  const found = pictureNamed(document, resources, resourceName);
  const info = describePicture(document, found.ref, found.stream);
  const raster = readRaster(info, codec);
  if (raster === null) throw cannotCut(`${info.kind} picture, ${String(info.channels)} channels`);

  const box = pixelBox(crop, raster.width, raster.height);
  const cut = cutRaster(raster, box);
  const rounded = {
    x: box.left / raster.width,
    y: 1 - box.bottom / raster.height,
    width: (box.right - box.left) / raster.width,
    height: (box.bottom - box.top) / raster.height,
  };

  const mask = softMaskOf(document, found.stream, codec);
  if (mask !== null) {
    if (mask.width !== raster.width || mask.height !== raster.height) {
      throw cannotCut('its transparency is a different size from the picture');
    }
    const alpha = cutRaster(mask, box);
    return { bytes: withAlpha(cut, alpha), crop: rounded };
  }

  if (info.kind === 'jpeg' && codec !== null) {
    return { bytes: codec.encodeJpeg(cut, JPEG_QUALITY), crop: rounded };
  }
  return {
    bytes: encodePng(cut.samples, cut.width, cut.height, cut.channels, 8),
    crop: rounded,
  };
}

interface PixelBox {
  left: number;
  right: number;
  /** Rows count from the top, as the samples are stored. */
  top: number;
  bottom: number;
}

/**
 * The pixels a crop covers, rounded outwards so nothing that showed is lost.
 * The crop's y runs up from the bottom; the rows run down from the top.
 */
function pixelBox(crop: Crop, width: number, height: number): PixelBox {
  const clamp = (value: number, limit: number): number => Math.max(0, Math.min(limit, value));
  // A whisker of tolerance, so 0.5 of four pixels is two and not three.
  const floor = (value: number): number => Math.floor(value + 1e-9);
  const ceil = (value: number): number => Math.ceil(value - 1e-9);

  const left = clamp(floor(crop.x * width), width - 1);
  const right = clamp(ceil((crop.x + crop.width) * width), width);
  const top = clamp(floor((1 - (crop.y + crop.height)) * height), height - 1);
  const bottom = clamp(ceil((1 - crop.y) * height), height);
  return { left, right: Math.max(left + 1, right), top, bottom: Math.max(top + 1, bottom) };
}

function cutRaster(raster: Raster, box: PixelBox): Raster {
  const width = box.right - box.left;
  const height = box.bottom - box.top;
  const { channels } = raster;
  const samples = new Uint8Array(width * height * channels);
  for (let row = 0; row < height; row += 1) {
    const from = ((box.top + row) * raster.width + box.left) * channels;
    samples.set(raster.samples.subarray(from, from + width * channels), row * width * channels);
  }
  return { width, height, channels, samples };
}

/** Interleaves colour and transparency into one PNG. */
function withAlpha(colour: Raster, alpha: Raster): Uint8Array {
  const pixels = colour.width * colour.height;
  const components = colour.channels + 1;
  const samples = new Uint8Array(pixels * components);
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    for (let channel = 0; channel < colour.channels; channel += 1) {
      samples[pixel * components + channel] =
        colour.samples[pixel * colour.channels + channel] ?? 0;
    }
    samples[pixel * components + colour.channels] = alpha.samples[pixel] ?? 255;
  }
  return encodePng(samples, colour.width, colour.height, components, 8, true);
}

function pictureNamed(
  document: PDFDocument,
  resources: PDFDict | undefined,
  resourceName: string,
): { ref: PDFRef; stream: PDFRawStream } {
  const xobjects = resources?.lookup(PDFName.of('XObject'));
  const ref = xobjects instanceof PDFDict ? xobjects.get(PDFName.of(resourceName)) : undefined;
  const stream = ref instanceof PDFRef ? document.context.lookup(ref) : undefined;
  if (!(ref instanceof PDFRef) || !(stream instanceof PDFRawStream)) {
    throw new AppError('internal/unexpected', {
      message: 'That image is no longer on the page.',
      details: resourceName,
    });
  }
  return { ref, stream };
}

/**
 * The picture's soft mask as grey samples; null when it has none. A colour-key
 * or stencil mask cannot be carried through a cut, so it is refused.
 */
function softMaskOf(
  document: PDFDocument,
  stream: PDFRawStream,
  codec: ImageCodec | null,
): Raster | null {
  if (stream.dict.has(PDFName.of('Mask'))) throw cannotCut('it has a colour-key or stencil mask');
  const ref = stream.dict.get(PDFName.of('SMask'));
  if (ref === undefined) return null;

  const mask = document.context.lookup(ref);
  if (!(ref instanceof PDFRef) || !(mask instanceof PDFRawStream)) {
    throw cannotCut('its transparency could not be read');
  }
  const info = describePicture(document, ref, mask);
  const raster = info.channels === 1 ? readRaster(info, codec) : null;
  if (raster === null) throw cannotCut('its transparency could not be read');
  return raster;
}

function cannotCut(details: string): AppError {
  return new AppError('pdf/malformed-content', {
    message:
      'PaperForge cannot cut this picture down. Crop it without cutting instead; the hidden part stays in the file.',
    details,
  });
}
