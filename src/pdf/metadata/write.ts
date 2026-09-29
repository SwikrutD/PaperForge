import { PDFHexString, PDFName, PDFString, type PDFDict, type PDFDocument } from 'pdf-lib';
import type { EditOperation } from '@shared/schemas/edit';
import type { CustomMetadataEntry, DocumentMetadata } from '@shared/schemas/metadata';
import { readInfoDictionary } from './read';

/**
 * Writing document properties.
 *
 * A null field removes the entry; it does not write an empty string. The two
 * look the same in a text box and are not the same in a file, and a reader who
 * clears the author is asking for the author to be gone.
 */

const FIELD_KEYS: Record<keyof DocumentMetadata, string> = {
  title: 'Title',
  author: 'Author',
  subject: 'Subject',
  keywords: 'Keywords',
  creator: 'Creator',
  producer: 'Producer',
  createdAt: 'CreationDate',
  modifiedAt: 'ModDate',
};

const DATE_FIELDS = new Set<keyof DocumentMetadata>(['createdAt', 'modifiedAt']);

/** Entries the standard fields own, which `custom` must not fight over. */
const RESERVED = new Set([...Object.values(FIELD_KEYS), 'Trapped']);

export function applyMetadataOperation(document: PDFDocument, operation: EditOperation): boolean {
  if (operation.kind === 'setMetadata') {
    writeMetadata(document, operation.metadata, operation.custom);
    if (operation.removeXmpMetadata) removeXmp(document);
    return true;
  }

  if (operation.kind === 'setDocumentLanguage') {
    if (operation.language === null || operation.language.trim() === '') {
      document.catalog.delete(PDFName.of('Lang'));
    } else {
      document.catalog.set(PDFName.of('Lang'), PDFString.of(operation.language.trim()));
    }
    return true;
  }

  return false;
}

export function writeMetadata(
  document: PDFDocument,
  metadata: DocumentMetadata,
  custom: readonly CustomMetadataEntry[],
): void {
  const info = infoDictionary(document);

  for (const [field, key] of Object.entries(FIELD_KEYS) as Array<
    [keyof DocumentMetadata, string]
  >) {
    const value = metadata[field];
    if (value === null || value === '') {
      info.delete(PDFName.of(key));
      continue;
    }

    if (DATE_FIELDS.has(field)) {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) info.delete(PDFName.of(key));
      else info.set(PDFName.of(key), PDFString.fromDate(date));
      continue;
    }

    // Hex strings carry UTF-16, so a title with an accent survives the trip.
    info.set(PDFName.of(key), PDFHexString.fromText(value));
  }

  // The custom entries given replace whatever non-standard entries were there.
  for (const [key] of info.entries()) {
    const name = key.decodeText();
    if (!RESERVED.has(name)) info.delete(key);
  }
  for (const entry of custom) {
    const name = entry.name.trim();
    if (name === '' || RESERVED.has(name)) continue;
    info.set(PDFName.of(name), PDFHexString.fromText(entry.value));
  }
}

/** Takes the XMP packet off the catalogue and off every page. */
export function removeXmp(document: PDFDocument): void {
  document.catalog.delete(PDFName.of('Metadata'));
  for (const page of document.getPages()) {
    page.node.delete(PDFName.of('Metadata'));
  }
}

/** Empties the information dictionary, leaving the dictionary itself. */
export function removeInfoEntries(document: PDFDocument): number {
  const info = readInfoDictionary(document);
  if (info === undefined) return 0;

  const keys = [...info.entries()].map(([key]) => key);
  for (const key of keys) info.delete(key);
  return keys.length;
}

/** The information dictionary, made if the document has none. */
export function infoDictionary(document: PDFDocument): PDFDict {
  const existing = readInfoDictionary(document);
  if (existing !== undefined) return existing;

  const dict = document.context.obj({});
  document.context.trailerInfo.Info = document.context.register(dict);
  return dict;
}
