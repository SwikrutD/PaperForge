import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFString,
  type PDFDocument,
  type PDFObject,
  type PDFPage,
} from 'pdf-lib';
import type {
  CustomMetadataEntry,
  DocumentFont,
  DocumentMetadata,
  PageSizeSummary,
} from '@shared/schemas/metadata';
import { EMPTY_METADATA } from '@shared/schemas/metadata';
import { latin1Text } from '@shared/utils/bytes';
import { resourcesOf } from '../content/pageContent';

/**
 * Reading what a document says about itself.
 *
 * Everything comes from the structure: the information dictionary, the
 * catalogue and the page tree. Nothing is inferred and nothing is invented —
 * a field the document does not carry is reported as absent, not as empty.
 */

/** The information dictionary entries that have a field of their own. */
const STANDARD_KEYS = new Set([
  'Title',
  'Author',
  'Subject',
  'Keywords',
  'Creator',
  'Producer',
  'CreationDate',
  'ModDate',
  'Trapped',
]);

/** How far into the file the linearization dictionary must appear. */
const LINEARIZED_WINDOW = 2048;

export function readInfoDictionary(document: PDFDocument): PDFDict | undefined {
  return document.context.lookupMaybe(document.context.trailerInfo.Info, PDFDict);
}

export function readMetadata(document: PDFDocument): DocumentMetadata {
  const info = readInfoDictionary(document);
  if (info === undefined) return EMPTY_METADATA;

  return {
    title: textEntry(info, 'Title'),
    author: textEntry(info, 'Author'),
    subject: textEntry(info, 'Subject'),
    keywords: textEntry(info, 'Keywords'),
    creator: textEntry(info, 'Creator'),
    producer: textEntry(info, 'Producer'),
    createdAt: dateEntry(info, 'CreationDate'),
    modifiedAt: dateEntry(info, 'ModDate'),
  };
}

/** Information dictionary entries beyond the standard ones. */
export function readCustomMetadata(document: PDFDocument): CustomMetadataEntry[] {
  const info = readInfoDictionary(document);
  if (info === undefined) return [];

  const entries: CustomMetadataEntry[] = [];
  for (const [key, value] of info.entries()) {
    const name = key.decodeText();
    if (STANDARD_KEYS.has(name)) continue;
    const text = valueText(document, value);
    if (text === null) continue;
    entries.push({ name: name.slice(0, 200), value: text.slice(0, 2000) });
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

export function hasXmpMetadata(document: PDFDocument): boolean {
  return document.catalog.get(PDFName.of('Metadata')) !== undefined;
}

/** True when the catalogue declares a structure tree or marked content. */
export function isTagged(document: PDFDocument): boolean {
  if (document.catalog.get(PDFName.of('StructTreeRoot')) !== undefined) return true;
  const markInfo = document.context.lookupMaybe(
    document.catalog.get(PDFName.of('MarkInfo')),
    PDFDict,
  );
  return markInfo?.lookup(PDFName.of('Marked')) === PDFBool.True;
}

export function readLanguage(document: PDFDocument): string | null {
  const value = document.catalog.lookup(PDFName.of('Lang'));
  if (value instanceof PDFString || value instanceof PDFHexString) {
    const text = value.decodeText().trim();
    return text === '' ? null : text.slice(0, 100);
  }
  return null;
}

/**
 * True when the file is laid out for fast web view.
 *
 * A linearized file states so in a dictionary that must be the first object,
 * so only the start of the file is worth looking at.
 */
export function isLinearized(bytes: Uint8Array): boolean {
  const start = bytes.subarray(0, Math.min(LINEARIZED_WINDOW, bytes.length));
  return latin1Text(start).includes('/Linearized');
}

/** Page sizes, grouped, largest group first, as the page is displayed. */
export function readPageSizes(document: PDFDocument): PageSizeSummary[] {
  const counts = new Map<string, PageSizeSummary>();

  for (const page of document.getPages()) {
    const { width, height } = displayedSize(page);
    const key = `${String(width)}x${String(height)}`;
    const existing = counts.get(key);
    if (existing === undefined) counts.set(key, { width, height, pageCount: 1 });
    else existing.pageCount += 1;
  }

  return [...counts.values()].sort((a, b) => b.pageCount - a.pageCount).slice(0, 200);
}

/** A page's size with its rotation applied, rounded the way a dialog shows it. */
function displayedSize(page: PDFPage): { width: number; height: number } {
  const { width, height } = page.getSize();
  const quarter = (((Math.round(page.getRotation().angle / 90) % 4) + 4) % 4) % 4;
  const swapped = quarter === 1 || quarter === 3;
  return {
    width: round(swapped ? height : width),
    height: round(swapped ? width : height),
  };
}

function round(value: number): number {
  return Math.max(0.1, Math.round(value * 10) / 10);
}

/**
 * Every font the pages name, once each.
 *
 * Fonts inside form XObjects are not walked: this is the same page-level view
 * the text editor takes, and saying so is better than half a listing.
 */
export function readFonts(document: PDFDocument): DocumentFont[] {
  const found = new Map<string, DocumentFont>();

  for (const page of document.getPages()) {
    const resources = resourcesOf(document, page);
    const fonts = document.context.lookupMaybe(resources?.get(PDFName.of('Font')), PDFDict);
    if (fonts === undefined) continue;

    for (const [, value] of fonts.entries()) {
      const dict = document.context.lookupMaybe(value, PDFDict);
      if (dict === undefined) continue;
      const font = describeFont(document, dict);
      if (!found.has(font.name)) found.set(font.name, font);
    }
  }

  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 500);
}

function describeFont(document: PDFDocument, dict: PDFDict): DocumentFont {
  const subtype = nameOf(dict.lookup(PDFName.of('Subtype'))) ?? 'Unknown';
  const baseFont = nameOf(dict.lookup(PDFName.of('BaseFont'))) ?? 'Unnamed';

  // A Type0 font keeps its programme on the descendant, not on itself.
  const descendants = document.context.lookupMaybe(
    dict.get(PDFName.of('DescendantFonts')),
    PDFArray,
  );
  const descendant =
    descendants === undefined || descendants.size() === 0
      ? undefined
      : document.context.lookupMaybe(descendants.get(0), PDFDict);

  const descriptor = document.context.lookupMaybe(
    (descendant ?? dict).get(PDFName.of('FontDescriptor')),
    PDFDict,
  );

  const embedded =
    descriptor !== undefined &&
    (['FontFile', 'FontFile2', 'FontFile3'] as const).some(
      (key) => descriptor.get(PDFName.of(key)) !== undefined,
    );

  const encodingValue = dict.lookup(PDFName.of('Encoding'));
  const encoding =
    nameOf(encodingValue) ??
    (encodingValue instanceof PDFDict
      ? (nameOf(encodingValue.lookup(PDFName.of('BaseEncoding'))) ?? 'Custom')
      : null);

  return {
    name: baseFont.slice(0, 300),
    type: subtype.slice(0, 100),
    embedded,
    // A subset font's name is prefixed with six capitals and a plus sign.
    subset: /^[A-Z]{6}\+/.test(baseFont),
    encoding: encoding === null ? null : encoding.slice(0, 100),
  };
}

// --------------------------------------------------------------- values ---

function textEntry(info: PDFDict, key: string): string | null {
  const value = info.lookup(PDFName.of(key));
  if (!(value instanceof PDFString || value instanceof PDFHexString)) return null;
  const text = value.decodeText();
  return text === '' ? null : text.slice(0, 2000);
}

/** A date entry as ISO 8601, or null when the document writes an unreadable one. */
function dateEntry(info: PDFDict, key: string): string | null {
  const value = info.lookup(PDFName.of(key));
  if (!(value instanceof PDFString || value instanceof PDFHexString)) return null;

  const parsed = parsePdfDate(value.decodeText());
  return parsed === null ? null : parsed.toISOString();
}

/**
 * `D:YYYYMMDDHHmmSS+HH'mm'`, of which everything after the year is optional.
 */
export function parsePdfDate(value: string): Date | null {
  const match =
    /^D?:?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(?:([+-Z])(\d{2})'?(\d{2})?'?)?/.exec(
      value.trim(),
    );
  if (match === null) return null;

  const part = (index: number, fallback: number): number =>
    match[index] === undefined ? fallback : Number.parseInt(match[index], 10);

  const year = part(1, 0);
  if (year < 1 || year > 9999) return null;

  const sign = match[7];
  const offsetMinutes =
    sign === undefined || sign === 'Z'
      ? 0
      : (sign === '-' ? -1 : 1) * (part(8, 0) * 60 + part(9, 0));

  const utc = Date.UTC(year, part(2, 1) - 1, part(3, 1), part(4, 0), part(5, 0), part(6, 0));
  const date = new Date(utc - offsetMinutes * 60_000);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** A dictionary value as text, for the custom entries listing. */
function valueText(document: PDFDocument, value: PDFObject): string | null {
  const resolved = document.context.lookup(value);
  if (resolved instanceof PDFString || resolved instanceof PDFHexString) {
    return resolved.decodeText();
  }
  if (resolved instanceof PDFName) return resolved.decodeText();
  if (resolved instanceof PDFNumber) return String(resolved.asNumber());
  if (resolved instanceof PDFBool) return resolved.asBoolean() ? 'true' : 'false';
  return null;
}

function nameOf(value: unknown): string | null {
  return value instanceof PDFName ? value.decodeText() : null;
}
