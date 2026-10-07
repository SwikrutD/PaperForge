import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  decodePDFRawStream,
  type PDFDocument,
  type PDFObject,
} from 'pdf-lib';
import type { OptimizeSettings } from '@shared/schemas/optimize';
import type { DrawnSize, PictureUse } from './placements';
import {
  downsample,
  looksPhotographic,
  toGrey,
  toRgb,
  type ImageCodec,
  type Raster,
} from './pixels';

/**
 * Making the pictures in a document smaller.
 *
 * A picture is replaced where it is stored, so every page that draws it draws
 * the new one and nothing else in the document changes. Only pictures
 * PaperForge can read back exactly are touched: 8-bit grey or RGB samples,
 * stored plainly, deflated, or as JPEG. Anything else — CMYK, indexed colour,
 * JBIG2, JPEG 2000, colour-keyed masks, decode arrays — is left exactly as it
 * was. A replacement that would come out larger is not made.
 */

/** Only resample when a picture has comfortably more pixels than it needs. */
const RESAMPLE_THRESHOLD = 1.5;
/** Pictures larger than this are left alone rather than decoded into memory. */
const MAX_PIXELS = 60_000_000;

export type PictureKind = 'jpeg' | 'lossless' | 'untouchable';

export interface PictureInfo {
  ref: PDFRef;
  stream: PDFRawStream;
  kind: PictureKind;
  width: number;
  height: number;
  /** 1 or 3 for a picture PaperForge can work on. */
  channels: 1 | 3 | null;
  storedBytes: number;
}

export interface PictureTally {
  resampled: number;
  recompressed: number;
  converted: number;
  greyed: number;
  kept: number;
}

/** Every picture in the document, and whether PaperForge can work on it. */
export function listPictures(document: PDFDocument): PictureInfo[] {
  const pictures: PictureInfo[] = [];
  for (const [ref, object] of document.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue;
    if (object.dict.lookup(PDFName.of('Subtype')) !== PDFName.of('Image')) continue;
    pictures.push(describePicture(document, ref, object));
  }
  return pictures;
}

/** The resolution a picture is drawn at, or null when it is not measured. */
export function drawnDpi(picture: PictureInfo, size: DrawnSize | undefined): number | null {
  if (size === undefined || size.width <= 0 || size.height <= 0) return null;
  return Math.min(picture.width / (size.width / 72), picture.height / (size.height / 72));
}

export function optimizePictures(
  document: PDFDocument,
  settings: OptimizeSettings,
  use: PictureUse,
  codec: ImageCodec | null,
): PictureTally {
  const tally: PictureTally = { resampled: 0, recompressed: 0, converted: 0, greyed: 0, kept: 0 };
  const smasksDone = new Set<string>();

  for (const picture of listPictures(document)) {
    if (picture.kind === 'untouchable' || picture.channels === null) continue;
    const key = picture.ref.toString();

    // A picture drawn somewhere that could not be measured keeps its size.
    const dpi = use.unmeasured.has(key) ? null : drawnDpi(picture, use.measured.get(key));
    const factor =
      settings.downsample && dpi !== null && dpi > settings.targetDpi * RESAMPLE_THRESHOLD
        ? settings.targetDpi / dpi
        : 1;
    const resample = factor < 1;
    const grey = settings.grayscaleImages && picture.channels === 3;

    const wantsWork =
      resample ||
      grey ||
      (picture.kind === 'jpeg' && settings.recompressJpeg) ||
      (picture.kind === 'lossless' && settings.convertPhotos);
    if (!wantsWork) continue;

    let raster = readRaster(picture, codec);
    if (raster === null) continue;
    if (grey) raster = toGrey(raster);
    if (resample) {
      raster = downsample(raster, picture.width * factor, picture.height * factor);
    }

    // Photographs, and anything that already was a JPEG, go back as JPEG;
    // drawings and screenshots stay lossless.
    const asJpeg =
      codec !== null &&
      (picture.kind === 'jpeg' || (settings.convertPhotos && looksPhotographic(raster)));
    if (picture.kind === 'lossless' && !asJpeg && !resample && !grey) continue;

    const replacement = asJpeg
      ? jpegStream(document, picture, raster, codec, settings.jpegQuality)
      : flateStream(document, picture, raster);

    // A smaller file is the point; a picture the reader asked to grey is
    // replaced even when grey does not happen to come out smaller.
    if (!grey && replacement.contents.length >= picture.storedBytes) {
      tally.kept += 1;
      continue;
    }

    document.context.assign(picture.ref, replacement);
    if (resample) {
      tally.resampled += 1;
      resampleSoftMask(document, picture, raster, smasksDone);
    } else if (picture.kind === 'jpeg') tally.recompressed += 1;
    if (picture.kind === 'lossless' && asJpeg) tally.converted += 1;
    if (grey) tally.greyed += 1;
  }

  return tally;
}

/** What a stored picture is, and whether PaperForge can read its samples. */
export function describePicture(
  document: PDFDocument,
  ref: PDFRef,
  stream: PDFRawStream,
): PictureInfo {
  const dict = stream.dict;
  const width = numberOf(dict.lookup(PDFName.of('Width')));
  const height = numberOf(dict.lookup(PDFName.of('Height')));
  const base = { ref, stream, width, height, storedBytes: stream.contents.length };
  const untouchable = { ...base, kind: 'untouchable' as const, channels: null };

  const mask = dict.lookup(PDFName.of('ImageMask'));
  if (mask instanceof PDFBool && mask.asBoolean()) return untouchable;
  // A colour key picks out exact sample values, which a lossy picture no
  // longer has; a decode array would have to be carried through every change.
  if (dict.lookup(PDFName.of('Mask')) instanceof PDFArray) return untouchable;
  if (dict.has(PDFName.of('Decode'))) return untouchable;
  if (numberOf(dict.lookup(PDFName.of('BitsPerComponent'))) !== 8) return untouchable;
  if (width <= 0 || height <= 0 || width * height > MAX_PIXELS) return untouchable;

  const channels = channelsOf(document, dict.get(PDFName.of('ColorSpace')));
  if (channels === null) return untouchable;

  const filters = filtersOf(document, dict.lookup(PDFName.of('Filter')));
  if (filters === null) return untouchable;
  if (filters.length === 1 && filters[0] === 'DCTDecode') {
    return { ...base, kind: 'jpeg', channels };
  }
  if (filters.length === 0 || (filters.length === 1 && filters[0] === 'FlateDecode')) {
    if (hasPredictor(document, dict.lookup(PDFName.of('DecodeParms')))) return untouchable;
    return { ...base, kind: 'lossless', channels };
  }
  return untouchable;
}

/** A picture's samples, or null when PaperForge cannot read them exactly. */
export function readRaster(picture: PictureInfo, codec: ImageCodec | null): Raster | null {
  if (picture.channels === null) return null;
  if (picture.kind === 'jpeg') {
    if (codec === null) return null;
    const decoded = safely(() => codec.decodeJpeg(picture.stream.contents));
    if (decoded === null || decoded.width !== picture.width || decoded.height !== picture.height) {
      return null;
    }
    // The codec hands back colour; a grey JPEG goes back to grey.
    return picture.channels === 1 ? toGrey(decoded) : decoded;
  }

  const samples = safely(() => decodePDFRawStream(picture.stream).decode());
  const expected = picture.width * picture.height * picture.channels;
  if (samples === null || samples.length < expected) return null;
  return {
    width: picture.width,
    height: picture.height,
    channels: picture.channels,
    samples: samples.subarray(0, expected),
  };
}

function jpegStream(
  document: PDFDocument,
  picture: PictureInfo,
  raster: Raster,
  codec: ImageCodec,
  quality: number,
): PDFRawStream {
  // Chromium's encoder writes colour JPEGs; a grey picture is written as
  // colour and described as such.
  const bytes = codec.encodeJpeg(toRgb(raster), quality);
  const colourSpace =
    raster.channels === 3 && picture.channels === 3
      ? picture.stream.dict.get(PDFName.of('ColorSpace'))
      : PDFName.of('DeviceRGB');
  return PDFRawStream.of(
    replacementDict(
      document,
      picture.stream.dict,
      raster,
      colourSpace ?? PDFName.of('DeviceRGB'),
      'DCTDecode',
    ),
    bytes,
  );
}

function flateStream(document: PDFDocument, picture: PictureInfo, raster: Raster): PDFRawStream {
  const colourSpace =
    raster.channels === picture.channels
      ? (picture.stream.dict.get(PDFName.of('ColorSpace')) ?? PDFName.of('DeviceGray'))
      : PDFName.of('DeviceGray');
  const compressed = document.context.flateStream(raster.samples);
  return PDFRawStream.of(
    replacementDict(document, picture.stream.dict, raster, colourSpace, 'FlateDecode'),
    compressed.contents,
  );
}

/** The picture's own dictionary, with what describes its samples replaced. */
function replacementDict(
  document: PDFDocument,
  original: PDFDict,
  raster: Raster,
  colourSpace: PDFObject,
  filter: 'DCTDecode' | 'FlateDecode',
): PDFDict {
  const dict = document.context.obj({});
  for (const [key, value] of original.entries()) {
    if (REPLACED_KEYS.has(key.decodeText())) continue;
    dict.set(key, value);
  }
  dict.set(PDFName.of('Width'), PDFNumber.of(raster.width));
  dict.set(PDFName.of('Height'), PDFNumber.of(raster.height));
  dict.set(PDFName.of('ColorSpace'), colourSpace);
  dict.set(PDFName.of('BitsPerComponent'), PDFNumber.of(8));
  dict.set(PDFName.of('Filter'), PDFName.of(filter));
  return dict;
}

const REPLACED_KEYS = new Set([
  'Width',
  'Height',
  'ColorSpace',
  'BitsPerComponent',
  'Filter',
  'DecodeParms',
  'Length',
]);

/**
 * A picture's transparency is a picture of its own, and is as large as the
 * picture was. It is made the new size too, when it is stored in a way that
 * can be read back exactly.
 */
function resampleSoftMask(
  document: PDFDocument,
  picture: PictureInfo,
  raster: Raster,
  done: Set<string>,
): void {
  const ref = picture.stream.dict.get(PDFName.of('SMask'));
  if (!(ref instanceof PDFRef) || done.has(ref.toString())) return;
  const mask = document.context.lookup(ref);
  if (!(mask instanceof PDFRawStream)) return;

  const info = describePicture(document, ref, mask);
  if (info.kind !== 'lossless' || info.channels !== 1) return;
  const samples = readRaster(info, null);
  if (samples === null) return;
  // Only a mask the same size as its picture is resized with it.
  if (info.width !== picture.width || info.height !== picture.height) return;

  const smaller = downsample(samples, raster.width, raster.height);
  document.context.assign(ref, flateStream(document, info, smaller));
  done.add(ref.toString());
}

function channelsOf(document: PDFDocument, space: PDFObject | undefined): 1 | 3 | null {
  const resolved = space === undefined ? undefined : document.context.lookup(space);
  if (resolved instanceof PDFName) {
    const name = resolved.decodeText();
    if (name === 'DeviceGray') return 1;
    if (name === 'DeviceRGB') return 3;
    return null;
  }
  if (resolved instanceof PDFArray && resolved.size() === 2) {
    const family = resolved.lookup(0);
    if (!(family instanceof PDFName) || family.decodeText() !== 'ICCBased') return null;
    const profile = resolved.lookup(1);
    const count = numberOf(
      profile instanceof PDFStream ? profile.dict.lookup(PDFName.of('N')) : undefined,
    );
    return count === 1 || count === 3 ? count : null;
  }
  return null;
}

function filtersOf(document: PDFDocument, filter: PDFObject | undefined): string[] | null {
  if (filter === undefined) return [];
  if (filter instanceof PDFName) return [filter.decodeText()];
  if (!(filter instanceof PDFArray)) return null;
  const names: string[] = [];
  for (const item of filter.asArray()) {
    const resolved = document.context.lookup(item);
    if (!(resolved instanceof PDFName)) return null;
    names.push(resolved.decodeText());
  }
  return names;
}

function hasPredictor(document: PDFDocument, parms: PDFObject | undefined): boolean {
  const parameters = document.context.lookupMaybe(
    parms instanceof PDFArray ? parms.get(0) : parms,
    PDFDict,
  );
  const predictor = parameters?.lookup(PDFName.of('Predictor'));
  return predictor !== undefined && numberOf(predictor) > 1;
}

function numberOf(value: PDFObject | undefined): number {
  return value instanceof PDFNumber ? value.asNumber() : 0;
}

function safely<T>(run: () => T): T | null {
  try {
    return run();
  } catch {
    return null;
  }
}
