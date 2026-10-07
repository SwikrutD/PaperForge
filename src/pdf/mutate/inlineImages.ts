import {
  PDFBool,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNull,
  PDFNumber,
  PDFRawStream,
  type PDFDocument,
  type PDFObject,
} from 'pdf-lib';
import type { InlineImage } from '@pdf/content/images';
import type { ContentValue } from '@pdf/content/values';

/**
 * An inline image as the image XObject it would be.
 *
 * `BI … ID … EI` holds the same dictionary and samples an image XObject does,
 * with shorter spellings. Spelled out and wrapped in a stream, it can be read,
 * exported and cut exactly like any other picture.
 */

/** Short names an inline image's dictionary values may use. */
const SHORT_VALUES: Record<string, string> = {
  G: 'DeviceGray',
  RGB: 'DeviceRGB',
  CMYK: 'DeviceCMYK',
  I: 'Indexed',
  AHx: 'ASCIIHexDecode',
  A85: 'ASCII85Decode',
  LZW: 'LZWDecode',
  Fl: 'FlateDecode',
  RL: 'RunLengthDecode',
  CCF: 'CCITTFaxDecode',
  DCT: 'DCTDecode',
};

/** Short keys, beyond the width, height and mask the content layer spells out. */
const SHORT_KEYS: Record<string, string> = {
  BPC: 'BitsPerComponent',
  CS: 'ColorSpace',
  D: 'Decode',
  DP: 'DecodeParms',
  F: 'Filter',
  I: 'Interpolate',
  L: 'Length',
};

/**
 * The inline image as a stream, not yet registered. A colour space named by
 * resource is looked up in the resources the image was drawn with.
 */
export function inlineImageStream(
  document: PDFDocument,
  image: InlineImage,
  resources: PDFDict | undefined,
): PDFRawStream {
  const dict = document.context.obj({ Type: 'XObject', Subtype: 'Image' });
  for (const [key, value] of image.entries) {
    const longKey = SHORT_KEYS[key] ?? key;
    if (longKey === 'Length') continue;
    dict.set(PDFName.of(longKey), objectOf(document, value, longKey, resources));
  }
  return PDFRawStream.of(dict, image.data);
}

function objectOf(
  document: PDFDocument,
  value: ContentValue,
  key: string,
  resources: PDFDict | undefined,
): PDFObject {
  switch (value.kind) {
    case 'number':
      return PDFNumber.of(value.value);
    case 'boolean':
      return value.value ? PDFBool.True : PDFBool.False;
    case 'null':
      return PDFNull;
    case 'string':
      return PDFHexString.of(
        Array.from(value.bytes, (byte) => byte.toString(16).padStart(2, '0')).join(''),
      );
    case 'array':
      return document.context.obj(
        value.items.map((item) => objectOf(document, item, key, resources)),
      );
    case 'dict': {
      const dict = document.context.obj({});
      for (const [entryKey, entry] of value.entries) {
        dict.set(PDFName.of(entryKey), objectOf(document, entry, entryKey, resources));
      }
      return dict;
    }
    case 'name': {
      const spelled = SHORT_VALUES[value.value];
      if (spelled !== undefined) return PDFName.of(spelled);
      if (key === 'ColorSpace' && !value.value.startsWith('Device')) {
        const spaces = resources?.lookup(PDFName.of('ColorSpace'));
        const named = spaces instanceof PDFDict ? spaces.get(PDFName.of(value.value)) : undefined;
        if (named !== undefined) return named;
      }
      return PDFName.of(value.value);
    }
  }
}
