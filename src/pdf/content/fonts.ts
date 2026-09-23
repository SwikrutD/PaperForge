import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  StandardFonts,
  decodePDFRawStream,
  type PDFFont,
  type PDFHexString,
  type PDFString,
} from 'pdf-lib';
import { parseContent } from './parser';
import type { ContentValue } from './values';
import {
  unicodeForCode,
  unicodeForGlyphName,
  codeForUnicode,
  type EncodingName,
} from './encodings';

/**
 * The fonts a page draws with, read from its resources.
 *
 * What text editing needs of a font is narrow: how its bytes split into
 * codes, what each code means, how wide it is, and — for writing text back —
 * which code writes a character. A font that cannot answer the last question
 * is not one PaperForge will rewrite natively, and it says so.
 */

export interface FontMetrics {
  /** Resource name, without its slash. */
  name: string;
  /** `/BaseFont`, as the file names it. */
  baseFont: string;
  /** Type0 fonts take two bytes to a code; simple fonts take one. */
  singleByte: boolean;
  /** True when the font's own program is in the file. */
  embedded: boolean;
  /** Splits a shown string into character codes. */
  codes(bytes: Uint8Array): number[];
  /** What a code says, or null when the font does not say. */
  unicode(code: number): string | null;
  /** Width of a code, in thousandths of a text unit. */
  width(code: number): number;
  /** The code that writes a character, or null when none does. */
  codeFor(character: string): number | null;
  /** Height above the baseline, in thousandths. */
  ascent: number;
  /** Depth below the baseline, in thousandths, as a negative number. */
  descent: number;
}

export type FontLookup = (name: string) => FontMetrics | undefined;

const DEFAULT_ASCENT = 750;
const DEFAULT_DESCENT = -250;
const DEFAULT_WIDTH = 500;

/** Reads every font a page's resources name. */
export async function readPageFonts(
  document: PDFDocument,
  resources: PDFDict | undefined,
): Promise<Map<string, FontMetrics>> {
  const fonts = new Map<string, FontMetrics>();
  const fontDict = resources?.lookup(PDFName.of('Font'));
  if (!(fontDict instanceof PDFDict)) return fonts;

  for (const [key, value] of fontDict.entries()) {
    const entry = document.context.lookup(value);
    if (!(entry instanceof PDFDict)) continue;
    const name = key.decodeText();
    fonts.set(name, await readFont(document, name, entry));
  }
  return fonts;
}

async function readFont(document: PDFDocument, name: string, dict: PDFDict): Promise<FontMetrics> {
  const subtype = nameValue(dict.lookup(PDFName.of('Subtype')));
  const baseFont = nameValue(dict.lookup(PDFName.of('BaseFont'))) ?? 'Unknown';
  const toUnicode = readToUnicode(document, dict);

  if (subtype === 'Type0') {
    return readCompositeFont(document, name, baseFont, dict, toUnicode);
  }
  return readSimpleFont(document, name, baseFont, dict, toUnicode);
}

/** A one-byte font: an encoding, a width array, and maybe a `ToUnicode`. */
async function readSimpleFont(
  document: PDFDocument,
  name: string,
  baseFont: string,
  dict: PDFDict,
  toUnicode: Map<number, string>,
): Promise<FontMetrics> {
  const { encoding, differences } = readEncoding(document, dict);
  const descriptor = document.context.lookupMaybe(dict.get(PDFName.of('FontDescriptor')), PDFDict);

  const firstChar = numberValue(dict.lookup(PDFName.of('FirstChar')), 0);
  const widths = numberArray(dict.lookup(PDFName.of('Widths')));
  const standard = widths.length === 0 ? await standardWidths(baseFont) : null;
  const missing = numberValue(descriptor?.lookup(PDFName.of('MissingWidth')), 0);

  return {
    name,
    baseFont,
    singleByte: true,
    embedded: hasFontFile(descriptor),
    codes: (bytes) => [...bytes],
    unicode: (code) => {
      const mapped = toUnicode.get(code);
      if (mapped !== undefined) return mapped;
      const glyphName = differences.get(code);
      if (glyphName !== undefined) return unicodeForGlyphName(glyphName);
      return unicodeForCode(encoding, code);
    },
    width: (code) => {
      const index = code - firstChar;
      const declared = widths[index];
      if (declared !== undefined) return declared;
      if (standard !== null) {
        const character = unicodeForCode(encoding, code);
        if (character !== null) return standard(character);
      }
      return missing > 0 ? missing : DEFAULT_WIDTH;
    },
    codeFor: (character) => {
      for (const [code, glyphName] of differences) {
        if (unicodeForGlyphName(glyphName) === character) return code;
      }
      const code = codeForUnicode(encoding, character);
      // A code the font has no glyph for would draw nothing.
      if (code === null) return null;
      return differences.has(code) && unicodeForGlyphName(differences.get(code) ?? '') !== character
        ? null
        : code;
    },
    ascent: numberValue(descriptor?.lookup(PDFName.of('Ascent')), DEFAULT_ASCENT),
    descent: numberValue(descriptor?.lookup(PDFName.of('Descent')), DEFAULT_DESCENT),
  };
}

/** A composite font: two-byte codes, `/W` widths and a CID mapping. */
function readCompositeFont(
  document: PDFDocument,
  name: string,
  baseFont: string,
  dict: PDFDict,
  toUnicode: Map<number, string>,
): FontMetrics {
  const descendants = document.context.lookupMaybe(
    dict.get(PDFName.of('DescendantFonts')),
    PDFArray,
  );
  const descendant = descendants === undefined ? undefined : lookupDict(document, descendants, 0);
  const descriptor = document.context.lookupMaybe(
    descendant?.get(PDFName.of('FontDescriptor')),
    PDFDict,
  );

  const defaultWidth = numberValue(descendant?.lookup(PDFName.of('DW')), 1000);
  const widths = readCidWidths(descendant?.lookup(PDFName.of('W')));
  // Identity is what nearly every generator writes; anything else needs the
  // CMap itself, which PaperForge does not rewrite.
  const encodingName = nameValue(dict.lookup(PDFName.of('Encoding'))) ?? '';
  const identity = encodingName.startsWith('Identity');

  const byCharacter = new Map<string, number>();
  for (const [code, text] of toUnicode) {
    if (!byCharacter.has(text)) byCharacter.set(text, code);
  }

  return {
    name,
    baseFont,
    singleByte: false,
    embedded: hasFontFile(descriptor),
    codes: (bytes) => {
      const codes: number[] = [];
      for (let index = 0; index + 1 < bytes.length; index += 2) {
        codes.push(((bytes[index] as number) << 8) | (bytes[index + 1] as number));
      }
      // A trailing odd byte is not a code; it is a damaged string.
      if (bytes.length % 2 === 1) codes.push(bytes[bytes.length - 1] as number);
      return codes;
    },
    unicode: (code) => toUnicode.get(code) ?? null,
    width: (code) => widths.get(code) ?? defaultWidth,
    codeFor: (character) => (identity ? (byCharacter.get(character) ?? null) : null),
    ascent: numberValue(descriptor?.lookup(PDFName.of('Ascent')), DEFAULT_ASCENT),
    descent: numberValue(descriptor?.lookup(PDFName.of('Descent')), DEFAULT_DESCENT),
  };
}

function readEncoding(
  document: PDFDocument,
  dict: PDFDict,
): { encoding: EncodingName; differences: Map<number, string> } {
  const differences = new Map<number, string>();
  const value = dict.lookup(PDFName.of('Encoding'));

  const named = nameValue(value);
  if (named !== null) {
    return { encoding: asEncodingName(named), differences };
  }

  if (value instanceof PDFDict) {
    const base = asEncodingName(nameValue(value.lookup(PDFName.of('BaseEncoding'))) ?? '');
    const list = document.context.lookupMaybe(value.get(PDFName.of('Differences')), PDFArray);

    let code = 0;
    for (let index = 0; index < (list?.size() ?? 0); index += 1) {
      const item = list?.lookup(index);
      if (item instanceof PDFNumber) code = item.asNumber();
      else if (item instanceof PDFName) {
        differences.set(code, item.decodeText());
        code += 1;
      }
    }
    return { encoding: base, differences };
  }

  return { encoding: 'StandardEncoding', differences };
}

function asEncodingName(value: string): EncodingName {
  if (value === 'MacRomanEncoding') return 'MacRomanEncoding';
  if (value === 'StandardEncoding' || value === '') return 'StandardEncoding';
  return 'WinAnsiEncoding';
}

/** `/W` is `[ start [w w w] start end w … ]`, in either form. */
function readCidWidths(value: unknown): Map<number, number> {
  const widths = new Map<number, number>();
  const array = value instanceof PDFArray ? value : undefined;
  if (array === undefined) return widths;

  let index = 0;
  while (index < array.size()) {
    const first = array.lookup(index);
    if (!(first instanceof PDFNumber)) break;
    const start = first.asNumber();
    const second = array.lookup(index + 1);

    if (second instanceof PDFArray) {
      for (let offset = 0; offset < second.size(); offset += 1) {
        const width = second.lookup(offset);
        if (width instanceof PDFNumber) widths.set(start + offset, width.asNumber());
      }
      index += 2;
      continue;
    }

    const third = array.lookup(index + 2);
    if (second instanceof PDFNumber && third instanceof PDFNumber) {
      const end = second.asNumber();
      const width = third.asNumber();
      // A range of thousands of identical widths is normal; a range of
      // millions is a damaged file.
      for (let code = start; code <= Math.min(end, start + 65_535); code += 1) {
        widths.set(code, width);
      }
      index += 3;
      continue;
    }
    break;
  }
  return widths;
}

/**
 * Reads a `ToUnicode` CMap.
 *
 * A CMap is written in the same postfix syntax as a content stream, so the
 * content parser reads it: `beginbfchar` and `beginbfrange` become operators
 * with the codes and their replacements as operands.
 */
function readToUnicode(document: PDFDocument, dict: PDFDict): Map<number, string> {
  const mapping = new Map<number, string>();
  const stream = document.context.lookup(dict.get(PDFName.of('ToUnicode')));
  if (!(stream instanceof PDFStream)) return mapping;

  let bytes: Uint8Array;
  try {
    bytes =
      stream instanceof PDFRawStream ? decodePDFRawStream(stream).decode() : stream.getContents();
  } catch {
    return mapping;
  }

  const operations = parseContent(bytes);
  for (const operation of operations) {
    if (operation.operator === 'endbfchar') {
      for (let index = 0; index + 1 < operation.operands.length; index += 2) {
        const code = codeOf(operation.operands[index]);
        const text = textOf(operation.operands[index + 1]);
        if (code !== null && text !== null) mapping.set(code, text);
      }
    }

    if (operation.operator === 'endbfrange') {
      for (let index = 0; index + 2 < operation.operands.length; index += 3) {
        const from = codeOf(operation.operands[index]);
        const to = codeOf(operation.operands[index + 1]);
        const target = operation.operands[index + 2];
        if (from === null || to === null || target === undefined) continue;

        if (target.kind === 'array') {
          target.items.forEach((item, offset) => {
            const text = textOf(item);
            if (text !== null) mapping.set(from + offset, text);
          });
          continue;
        }

        const start = textOf(target);
        if (start === null) continue;
        const base = start.codePointAt(start.length - 1) ?? 0;
        const prefix = start.slice(0, start.length - 1);
        for (let code = from; code <= Math.min(to, from + 65_535); code += 1) {
          mapping.set(code, `${prefix}${String.fromCodePoint(base + (code - from))}`);
        }
      }
    }
  }
  return mapping;
}

function codeOf(value: ContentValue | undefined): number | null {
  if (value?.kind !== 'string') return null;
  let code = 0;
  for (const byte of value.bytes) code = (code << 8) | byte;
  return code;
}

/** A CMap target is UTF-16BE, which is how a PDF spells Unicode. */
function textOf(value: ContentValue | undefined): string | null {
  if (value?.kind !== 'string') return null;
  const bytes = value.bytes;
  if (bytes.length === 0) return null;

  let text = '';
  for (let index = 0; index + 1 < bytes.length; index += 2) {
    text += String.fromCharCode(((bytes[index] as number) << 8) | (bytes[index + 1] as number));
  }
  if (bytes.length === 1) text = String.fromCharCode(bytes[0] as number);
  return text;
}

function hasFontFile(descriptor: PDFDict | undefined): boolean {
  if (descriptor === undefined) return false;
  return (
    descriptor.has(PDFName.of('FontFile')) ||
    descriptor.has(PDFName.of('FontFile2')) ||
    descriptor.has(PDFName.of('FontFile3'))
  );
}

function nameValue(value: unknown): string | null {
  return value instanceof PDFName ? value.decodeText() : null;
}

function numberValue(value: unknown, fallback: number): number {
  return value instanceof PDFNumber ? value.asNumber() : fallback;
}

function numberArray(value: unknown): number[] {
  const array = value instanceof PDFArray ? value : undefined;
  if (array === undefined) return [];
  const numbers: number[] = [];
  for (let index = 0; index < array.size(); index += 1) {
    const item = array.lookup(index);
    numbers.push(item instanceof PDFNumber ? item.asNumber() : 0);
  }
  return numbers;
}

function lookupDict(document: PDFDocument, array: PDFArray, index: number): PDFDict | undefined {
  const entry = array.get(index);
  const resolved = entry instanceof PDFRef ? document.context.lookup(entry) : entry;
  return resolved instanceof PDFDict ? resolved : undefined;
}

/**
 * The widths of the fonts every PDF reader already has.
 *
 * A standard font may omit `/Widths` entirely, so the metrics come from
 * pdf-lib's own copy of them — the same ones PaperForge draws appearance
 * streams with.
 */
const STANDARD_ALIASES: Record<string, StandardFonts> = {
  helvetica: StandardFonts.Helvetica,
  'helvetica-bold': StandardFonts.HelveticaBold,
  'helvetica-oblique': StandardFonts.HelveticaOblique,
  'helvetica-boldoblique': StandardFonts.HelveticaBoldOblique,
  arial: StandardFonts.Helvetica,
  'arial-bold': StandardFonts.HelveticaBold,
  courier: StandardFonts.Courier,
  'courier-bold': StandardFonts.CourierBold,
  'courier-oblique': StandardFonts.CourierOblique,
  'courier-boldoblique': StandardFonts.CourierBoldOblique,
  'times-roman': StandardFonts.TimesRoman,
  'times-bold': StandardFonts.TimesRomanBold,
  'times-italic': StandardFonts.TimesRomanItalic,
  'times-bolditalic': StandardFonts.TimesRomanBoldItalic,
  symbol: StandardFonts.Symbol,
  zapfdingbats: StandardFonts.ZapfDingbats,
};

let metricsDocument: PDFDocument | null = null;
const metricsCache = new Map<string, PDFFont>();

async function standardWidths(baseFont: string): Promise<((character: string) => number) | null> {
  // A subset prefix such as "ABCDEF+Helvetica" names the same metrics.
  const cleaned = baseFont.replace(/^[A-Z]{6}\+/, '').toLowerCase();
  const standard = STANDARD_ALIASES[cleaned];
  if (standard === undefined) return null;

  metricsDocument ??= await PDFDocument.create();
  let font = metricsCache.get(standard);
  if (font === undefined) {
    font = await metricsDocument.embedFont(standard);
    metricsCache.set(standard, font);
  }

  const embedded = font;
  return (character: string) => {
    try {
      // Measured at 1000 units, which is the scale widths are written in.
      return embedded.widthOfTextAtSize(character, 1000);
    } catch {
      return DEFAULT_WIDTH;
    }
  };
}

/** A font that answers nothing, for a resource that is missing or damaged. */
export function unknownFont(name: string): FontMetrics {
  return {
    name,
    baseFont: 'Unknown',
    singleByte: true,
    embedded: false,
    codes: (bytes) => [...bytes],
    unicode: () => null,
    width: () => DEFAULT_WIDTH,
    codeFor: () => null,
    ascent: DEFAULT_ASCENT,
    descent: DEFAULT_DESCENT,
  };
}

/** Hex strings and literal strings both reach `PDFString`; this reads either. */
export function decodeTextValue(value: PDFString | PDFHexString): string {
  return value.decodeText();
}
