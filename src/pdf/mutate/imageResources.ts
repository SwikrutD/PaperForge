import {
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFStream,
  decodePDFRawStream,
  type PDFDocument,
  type PDFPage,
} from 'pdf-lib';
import { AppError } from '@shared/errors/appError';
import type { ImageFacts } from '@pdf/content/images';

/**
 * The images a page has, and the images PaperForge puts there.
 *
 * An image lives in the page's resources as an XObject; the content stream
 * only names it. Reading one tells the editor how big it really is; adding one
 * gives it a name of PaperForge's own, so an image the reader added can be
 * told from one the document came with.
 */

/** Names an image resource PaperForge added. */
export const ADDED_IMAGE_PREFIX = 'PFImg';

/** What the page's XObjects are, by resource name. */
export function readXObjects(
  document: PDFDocument,
  resources: PDFDict | undefined,
): Map<string, ImageFacts> {
  const found = new Map<string, ImageFacts>();
  const xobjects = resources?.lookup(PDFName.of('XObject'));
  if (!(xobjects instanceof PDFDict)) return found;

  for (const [key, value] of xobjects.entries()) {
    const stream = document.context.lookup(value);
    if (!(stream instanceof PDFStream)) continue;

    const dict = stream.dict;
    const subtype = dict.lookup(PDFName.of('Subtype'));
    const isImage = subtype instanceof PDFName && subtype.decodeText() === 'Image';

    found.set(key.decodeText(), {
      width: numberOf(dict.lookup(PDFName.of('Width'))),
      height: numberOf(dict.lookup(PDFName.of('Height'))),
      isImage,
      hasAlpha: dict.has(PDFName.of('SMask')) || dict.has(PDFName.of('Mask')),
    });
  }
  return found;
}

function numberOf(value: unknown): number {
  return value instanceof PDFNumber ? value.asNumber() : 0;
}

/** The page's own resources, created when it only inherits some. */
export function ownResources(document: PDFDocument, page: PDFPage): PDFDict {
  const existing = document.context.lookupMaybe(page.node.get(PDFName.of('Resources')), PDFDict);
  if (existing !== undefined) return existing;

  const created = document.context.obj({});
  page.node.set(PDFName.of('Resources'), created);
  return created;
}

function subDictionary(document: PDFDocument, resources: PDFDict, key: string): PDFDict {
  const existing = document.context.lookupMaybe(resources.get(PDFName.of(key)), PDFDict);
  if (existing !== undefined) return existing;

  const created = document.context.obj({});
  resources.set(PDFName.of(key), created);
  return created;
}

/** Puts an image in a page's resources and says what to call it. */
export async function embedImage(
  document: PDFDocument,
  page: PDFPage,
  bytes: Uint8Array,
  format: 'png' | 'jpeg',
): Promise<{ name: string; width: number; height: number }> {
  const embedded =
    format === 'png' ? await document.embedPng(bytes) : await document.embedJpg(bytes);
  const xobjects = subDictionary(document, ownResources(document, page), 'XObject');

  // A name of PaperForge's own, and never one the page already uses.
  let index = 1;
  let name = `${ADDED_IMAGE_PREFIX}${String(index)}`;
  while (xobjects.has(PDFName.of(name))) {
    index += 1;
    name = `${ADDED_IMAGE_PREFIX}${String(index)}`;
  }

  xobjects.set(PDFName.of(name), embedded.ref);
  return { name, width: embedded.width, height: embedded.height };
}

/** True when a resource name is one PaperForge gave an image it added. */
export function isAddedImage(resourceName: string): boolean {
  return resourceName.startsWith(ADDED_IMAGE_PREFIX);
}

export interface ExportedImage {
  bytes: Uint8Array;
  /** The extension the bytes are, as a reader would name the file. */
  extension: 'jpg' | 'png';
}

/**
 * The bytes of an image on a page, ready to be written out.
 *
 * A JPEG comes out as it went in: the file already holds one. Anything else is
 * decoded to its samples and written as a PNG, which is lossless and needs no
 * further libraries.
 */
export function exportImage(
  document: PDFDocument,
  resources: PDFDict | undefined,
  resourceName: string,
): ExportedImage {
  const xobjects = resources?.lookup(PDFName.of('XObject'));
  const stream =
    xobjects instanceof PDFDict
      ? document.context.lookup(xobjects.get(PDFName.of(resourceName)))
      : undefined;

  if (!(stream instanceof PDFStream)) {
    throw new AppError('internal/unexpected', {
      message: 'That image is no longer on the page.',
      details: resourceName,
    });
  }

  const dict = stream.dict;
  const filters = filterNames(dict);
  const raw =
    stream instanceof PDFRawStream ? stream.asUint8Array() : new Uint8Array(stream.getContents());

  // A DCT stream is a JPEG file already; handing it over unchanged is both
  // lossless and exactly what the document holds.
  if (filters.includes('DCTDecode')) return { bytes: raw, extension: 'jpg' };

  const decoded =
    stream instanceof PDFRawStream ? decodePDFRawStream(stream).decode() : stream.getContents();

  return {
    bytes: encodePng(
      decoded,
      numberOf(dict.lookup(PDFName.of('Width'))),
      numberOf(dict.lookup(PDFName.of('Height'))),
      colorComponents(document, dict),
      numberOf(dict.lookup(PDFName.of('BitsPerComponent'))) || 8,
    ),
    extension: 'png',
  };
}

function filterNames(dict: PDFDict): string[] {
  const filter = dict.lookup(PDFName.of('Filter'));
  if (filter instanceof PDFName) return [filter.decodeText()];

  const names: string[] = [];
  const array = dict.lookup(PDFName.of('Filter'));
  if (array !== undefined && 'asArray' in array) {
    for (const entry of (array as { asArray: () => unknown[] }).asArray()) {
      if (entry instanceof PDFName) names.push(entry.decodeText());
    }
  }
  return names;
}

/** How many numbers make up one pixel of an image. */
function colorComponents(document: PDFDocument, dict: PDFDict): number {
  const space = dict.lookup(PDFName.of('ColorSpace'));
  const name = space instanceof PDFName ? space.decodeText() : '';

  if (name === 'DeviceGray' || name === 'CalGray' || name === 'G') return 1;
  if (name === 'DeviceCMYK' || name === 'CMYK') return 4;
  if (name === 'DeviceRGB' || name === 'CalRGB' || name === 'RGB') return 3;

  // An indexed or ICC space needs the image decoding properly, which is more
  // than exporting should attempt; the samples are written as they are.
  void document;
  return 3;
}

/**
 * Writes samples out as a PNG.
 *
 * Only what exporting a page image needs: eight bits a component, no
 * interlacing, one filter byte of zero on each row.
 */
export function encodePng(
  samples: Uint8Array,
  width: number,
  height: number,
  components: number,
  bitsPerComponent: number,
): Uint8Array {
  if (width <= 0 || height <= 0 || bitsPerComponent !== 8 || components === 4) {
    throw new AppError('internal/unexpected', {
      message: 'PaperForge cannot write that image out yet.',
      details: `${String(width)}×${String(height)}, ${String(components)} components at ${String(
        bitsPerComponent,
      )} bits`,
    });
  }

  const colorType = components === 1 ? 0 : 2;
  const rowLength = width * components;
  const raw = new Uint8Array((rowLength + 1) * height);

  for (let row = 0; row < height; row += 1) {
    raw[row * (rowLength + 1)] = 0;
    raw.set(samples.subarray(row * rowLength, (row + 1) * rowLength), row * (rowLength + 1) + 1);
  }

  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8;
  header[9] = colorType;

  return concat([
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflate(raw)),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, body.length);

  const typed = concat([
    Uint8Array.from([...type].map((character) => character.charCodeAt(0))),
    body,
  ]);
  const crc = new Uint8Array(4);
  new DataView(crc.buffer).setUint32(0, crc32(typed));
  return concat([length, typed, crc]);
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * A zlib stream with no compression.
 *
 * The bytes are already what the PDF held; storing them uncompressed keeps
 * this file free of any dependency, and the reader is writing one image out,
 * not a library of them.
 */
function deflate(data: Uint8Array): Uint8Array {
  const blocks: Uint8Array[] = [Uint8Array.from([0x78, 0x01])];
  const maxBlock = 0xffff;

  for (let offset = 0; offset < data.length || offset === 0; offset += maxBlock) {
    const slice = data.subarray(offset, Math.min(offset + maxBlock, data.length));
    const last = offset + maxBlock >= data.length ? 1 : 0;
    const header = new Uint8Array(5);
    header[0] = last;
    new DataView(header.buffer).setUint16(1, slice.length, true);
    new DataView(header.buffer).setUint16(3, ~slice.length & 0xffff, true);
    blocks.push(header, slice);
    if (last === 1) break;
  }

  blocks.push(adler32(data));
  return concat(blocks);
}

function adler32(data: Uint8Array): Uint8Array {
  let a = 1;
  let b = 0;
  for (const byte of data) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, ((b << 16) | a) >>> 0);
  return out;
}
