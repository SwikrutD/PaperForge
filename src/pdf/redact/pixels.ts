import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFStream,
  decodePDFRawStream,
  type PDFDocument,
  type PDFObject,
  type PDFRef,
} from 'pdf-lib';
import { applyMatrix, invert, type Matrix } from '../content/state';
import { boundsOfPoints, type Rect } from './geometry';

/**
 * Repainting the part of a picture that lies under a mark.
 *
 * The samples under the mark are overwritten in the picture's own data — not
 * covered, overwritten — and the result is written as a new image, so the
 * page that showed the old one now shows the new one and nothing else in the
 * document changes. Only pictures stored as plain or deflated samples can be
 * repainted here; anything else is the raster fallback's job.
 */

export interface RepaintableImage {
  width: number;
  height: number;
  components: 1 | 3 | 4;
  samples: Uint8Array;
  /** The image's colour space, carried over to the repainted copy as it is. */
  colorSpace: PDFObject;
}

/** Biggest picture repainted in place; a larger one goes to the fallback. */
const MAX_PIXELS = 60_000_000;

const NOT_REPAINTABLE =
  'A picture lies partly under a mark and is stored in a way PaperForge cannot repaint (such as JPEG).';

/** Reads a picture for repainting, or says why it cannot be. */
export function readRepaintable(
  document: PDFDocument,
  stream: PDFStream,
): RepaintableImage | string {
  const dict = stream.dict;
  const lookup = (key: string): PDFObject | undefined => dict.lookup(PDFName.of(key));

  const mask = lookup('ImageMask');
  if (mask instanceof PDFBool && mask.asBoolean()) return NOT_REPAINTABLE;
  if (dict.has(PDFName.of('SMask')) || dict.has(PDFName.of('Mask'))) {
    return 'A picture with its own transparency lies partly under a mark.';
  }
  if (dict.has(PDFName.of('Decode'))) return NOT_REPAINTABLE;
  if (numberOf(lookup('BitsPerComponent')) !== 8) return NOT_REPAINTABLE;
  if (!plainOrDeflated(document, lookup('Filter'), lookup('DecodeParms'))) return NOT_REPAINTABLE;

  const width = numberOf(lookup('Width'));
  const height = numberOf(lookup('Height'));
  const colorSpace = dict.get(PDFName.of('ColorSpace'));
  const components = componentsOf(document, colorSpace);
  if (components === null || colorSpace === undefined) return NOT_REPAINTABLE;
  if (width <= 0 || height <= 0 || width * height > MAX_PIXELS) return NOT_REPAINTABLE;

  let samples: Uint8Array;
  try {
    samples =
      stream instanceof PDFRawStream ? decodePDFRawStream(stream).decode() : stream.getContents();
  } catch {
    return NOT_REPAINTABLE;
  }
  if (samples.length < width * height * components) return NOT_REPAINTABLE;

  return { width, height, components, samples, colorSpace };
}

/**
 * The picture's samples with every pixel a mark touches painted the mark's
 * colour. A pixel only partly under a mark is painted too: a sliver of what
 * was there is still what was there.
 */
export function paintOver(
  image: RepaintableImage,
  ctm: Matrix,
  marks: readonly Rect[],
  fill: { r: number; g: number; b: number },
): Uint8Array | null {
  // The page draws the picture by mapping its unit square through `ctm`, so
  // the inverse takes a mark back into the picture's own square.
  const undo = invert(ctm);
  if (undo === null) return null;

  const { width, height, components } = image;
  const samples = image.samples.slice(0, width * height * components);
  const colour = colourIn(components, fill);

  for (const mark of marks) {
    const square = boundsOfPoints([
      applyMatrix(undo, mark.x, mark.y),
      applyMatrix(undo, mark.x + mark.width, mark.y),
      applyMatrix(undo, mark.x, mark.y + mark.height),
      applyMatrix(undo, mark.x + mark.width, mark.y + mark.height),
    ]);
    // Row 0 is the top of the picture, which is the top of its square.
    const fromColumn = clamp(Math.floor(square.x * width), 0, width);
    const toColumn = clamp(Math.ceil((square.x + square.width) * width), 0, width);
    const fromRow = clamp(Math.floor((1 - (square.y + square.height)) * height), 0, height);
    const toRow = clamp(Math.ceil((1 - square.y) * height), 0, height);

    for (let row = fromRow; row < toRow; row += 1) {
      for (let column = fromColumn; column < toColumn; column += 1) {
        samples.set(colour, (row * width + column) * components);
      }
    }
  }
  return samples;
}

/** Writes repainted samples as a new image and returns where it lives. */
export function writeRepainted(
  document: PDFDocument,
  image: RepaintableImage,
  samples: Uint8Array,
): PDFRef {
  const stream = document.context.flateStream(samples, {
    Type: 'XObject',
    Subtype: 'Image',
    Width: image.width,
    Height: image.height,
    ColorSpace: image.colorSpace,
    BitsPerComponent: 8,
  });
  return document.context.register(stream);
}

function numberOf(value: PDFObject | undefined): number {
  return value instanceof PDFNumber ? value.asNumber() : 0;
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

/** No filter, or Flate alone without a predictor. */
function plainOrDeflated(
  document: PDFDocument,
  filter: PDFObject | undefined,
  parms: PDFObject | undefined,
): boolean {
  let names: Array<PDFObject | undefined> = [];
  if (filter instanceof PDFName) names = [filter];
  else if (filter instanceof PDFArray) {
    names = filter.asArray().map((item) => document.context.lookup(item));
  } else if (filter !== undefined) return false;

  if (names.length === 0) return true;
  if (names.length > 1) return false;
  const only = names[0];
  if (!(only instanceof PDFName) || only.decodeText() !== 'FlateDecode') return false;

  // A predictor rearranges the bytes before deflating them; PaperForge does
  // not undo one, so a picture written with one is left to the fallback.
  const parameters = document.context.lookupMaybe(
    parms instanceof PDFArray ? parms.get(0) : parms,
    PDFDict,
  );
  const predictor = parameters?.lookup(PDFName.of('Predictor'));
  return predictor === undefined || numberOf(predictor) <= 1;
}

function componentsOf(document: PDFDocument, space: PDFObject | undefined): 1 | 3 | 4 | null {
  const resolved = space === undefined ? undefined : document.context.lookup(space);
  if (resolved instanceof PDFName) {
    const name = resolved.decodeText();
    if (name === 'DeviceGray') return 1;
    if (name === 'DeviceRGB') return 3;
    if (name === 'DeviceCMYK') return 4;
    return null;
  }
  if (resolved instanceof PDFArray && resolved.size() === 2) {
    const family = resolved.lookup(0);
    if (!(family instanceof PDFName) || family.decodeText() !== 'ICCBased') return null;
    const profile = resolved.lookup(1);
    const count = numberOf(
      profile instanceof PDFStream ? profile.dict.lookup(PDFName.of('N')) : undefined,
    );
    return count === 1 || count === 3 || count === 4 ? count : null;
  }
  return null;
}

/** The mark's colour in the picture's own space. */
function colourIn(components: 1 | 3 | 4, fill: { r: number; g: number; b: number }): Uint8Array {
  const byte = (value: number): number => Math.round(clamp(value, 0, 1) * 255);
  if (components === 1)
    return Uint8Array.of(byte(0.299 * fill.r + 0.587 * fill.g + 0.114 * fill.b));
  if (components === 3) return Uint8Array.of(byte(fill.r), byte(fill.g), byte(fill.b));

  const black = 1 - Math.max(fill.r, fill.g, fill.b);
  const part = (value: number): number => (black >= 1 ? 0 : (1 - value - black) / (1 - black));
  return Uint8Array.of(byte(part(fill.r)), byte(part(fill.g)), byte(part(fill.b)), byte(black));
}
