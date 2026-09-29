import {
  PDFArray,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFStream,
  PDFString,
  type PDFDocument,
} from 'pdf-lib';
import type { SanitizeCategory, SanitizeFinding, SanitizeReport } from '@shared/schemas/sanitize';
import { countOccurrences } from '@shared/utils/bytes';
import { SANITIZE_CATEGORIES } from '@shared/schemas/sanitize';
import { readAttachments } from '../attachments/read';
import { resourcesOf } from '../content/pageContent';
import { readCustomMetadata, readMetadata } from '../metadata/read';
import { collectActions } from './actions';

/**
 * What a document carries besides the pages it shows.
 *
 * The scan describes; it changes nothing. Every count is something actually
 * found in the file, so a clean report means the categories really are empty
 * rather than unexamined.
 */

/** Annotation flags: bit 2 is Hidden, bit 6 is NoView. */
const FLAG_HIDDEN = 1 << 1;
const FLAG_NO_VIEW = 1 << 5;

export function scanDocument(document: PDFDocument, bytes: Uint8Array): SanitizeReport {
  const counts = new Map<SanitizeCategory, { count: number; detail: string }>();
  const set = (category: SanitizeCategory, count: number, detail: string): void => {
    counts.set(category, { count, detail });
  };

  const metadata = readMetadata(document);
  const custom = readCustomMetadata(document);
  const named = Object.entries(metadata).filter(([, value]) => value !== null);
  set(
    'metadata',
    named.length + custom.length,
    named.length + custom.length === 0
      ? 'No document information is recorded.'
      : [...named.map(([field]) => field), ...custom.map((entry) => entry.name)]
          .slice(0, 12)
          .join(', '),
  );

  const xmpPages = document
    .getPages()
    .filter((page) => page.node.get(PDFName.of('Metadata')) !== undefined).length;
  const xmp = (document.catalog.get(PDFName.of('Metadata')) === undefined ? 0 : 1) + xmpPages;
  set(
    'xmpMetadata',
    xmp,
    xmp === 0 ? 'No XMP packet.' : `${String(xmp)} XML metadata packet${xmp === 1 ? '' : 's'}.`,
  );

  const attachments = readAttachments(document);
  set(
    'attachments',
    attachments.length,
    attachments.length === 0
      ? 'No files are carried inside this document.'
      : attachments
          .slice(0, 10)
          .map((record) => record.file.fileName)
          .join(', '),
  );

  const actions = collectActions(document);
  const scripts = actions.filter((action) => action.kind === 'javascript');
  set(
    'documentJavaScript',
    scripts.length,
    scripts.length === 0
      ? 'No scripts. PaperForge would not run them in any case.'
      : `${describeWhere(scripts.map((action) => action.where))}. PaperForge has not run them.`,
  );

  const reaching = actions.filter((action) => action.kind === 'reachingOut');
  set(
    'launchActions',
    reaching.length,
    reaching.length === 0
      ? 'Nothing starts a program or sends data away.'
      : reaching
          .slice(0, 8)
          .map((action) => `${action.type} (${action.where})`)
          .join(', '),
  );

  const hidden = hiddenAnnotationCount(document);
  set(
    'hiddenAnnotations',
    hidden,
    hidden === 0
      ? 'Every comment in this document is on show.'
      : `${String(hidden)} comment${hidden === 1 ? '' : 's'} marked hidden or not for display.`,
  );

  const filled = filledFieldNames(document);
  set(
    'formData',
    filled.length,
    filled.length === 0
      ? 'No form field holds a value.'
      : filled.slice(0, 10).join(', ') + (filled.length > 10 ? ', …' : ''),
  );

  const thumbnails = document
    .getPages()
    .filter((page) => page.node.get(PDFName.of('Thumb')) !== undefined).length;
  set(
    'thumbnails',
    thumbnails,
    thumbnails === 0
      ? 'No saved thumbnails.'
      : `${String(thumbnails)} page${thumbnails === 1 ? '' : 's'} carry a saved picture of themselves.`,
  );

  const hiddenLayers = hiddenLayerNames(document);
  set(
    'hiddenLayers',
    hiddenLayers.length,
    hiddenLayers.length === 0 ? 'No layer is switched off.' : hiddenLayers.slice(0, 10).join(', '),
  );

  const alternates = alternateImageCount(document);
  set(
    'alternateImages',
    alternates,
    alternates === 0
      ? 'No image carries a second version.'
      : `${String(alternates)} image${alternates === 1 ? '' : 's'} carry an alternate version.`,
  );

  const findings: SanitizeFinding[] = SANITIZE_CATEGORIES.map((category) => {
    const entry = counts.get(category) ?? { count: 0, detail: '' };
    return { category, count: entry.count, detail: entry.detail.slice(0, 2000) };
  });

  return { findings, hasIncrementalUpdates: countRevisions(bytes) > 1 };
}

/** "page 1 annotation, on open" — where the scripts were found, deduplicated. */
function describeWhere(places: readonly string[]): string {
  return [...new Set(places)].slice(0, 8).join(', ');
}

function hiddenAnnotationCount(document: PDFDocument): number {
  let hidden = 0;

  for (const page of document.getPages()) {
    const annotations = document.context.lookupMaybe(page.node.get(PDFName.of('Annots')), PDFArray);
    if (annotations === undefined) continue;

    for (let index = 0; index < annotations.size(); index += 1) {
      const annotation = document.context.lookupMaybe(annotations.get(index), PDFDict);
      const flags = annotation?.lookup(PDFName.of('F'));
      if (!(flags instanceof PDFNumber)) continue;
      const value = flags.asNumber();
      if ((value & FLAG_HIDDEN) !== 0 || (value & FLAG_NO_VIEW) !== 0) hidden += 1;
    }
  }
  return hidden;
}

/** Fields that hold a value, which is what a filled-in form leaves behind. */
function filledFieldNames(document: PDFDocument): string[] {
  let form;
  try {
    form = document.getForm();
  } catch {
    return [];
  }

  const names: string[] = [];
  for (const field of form.getFields()) {
    const dict = field.acroField.dict;
    if (dict.get(PDFName.of('V')) === undefined) continue;
    names.push(field.getName());
  }
  return names;
}

/** Optional content groups the default configuration switches off. */
function hiddenLayerNames(document: PDFDocument): string[] {
  const properties = document.context.lookupMaybe(
    document.catalog.get(PDFName.of('OCProperties')),
    PDFDict,
  );
  const configuration = document.context.lookupMaybe(properties?.get(PDFName.of('D')), PDFDict);
  const off = document.context.lookupMaybe(configuration?.get(PDFName.of('OFF')), PDFArray);
  if (off === undefined) return [];

  const names: string[] = [];
  for (let index = 0; index < off.size(); index += 1) {
    const group = document.context.lookupMaybe(off.get(index), PDFDict);
    const name = group?.lookup(PDFName.of('Name'));
    names.push(
      name instanceof PDFString || name instanceof PDFHexString
        ? name.decodeText()
        : `Layer ${String(index + 1)}`,
    );
  }
  return names;
}

/** Images carrying an /Alternates array, a second picture a reader may choose. */
function alternateImageCount(document: PDFDocument): number {
  let found = 0;

  for (const page of document.getPages()) {
    const xobjects = document.context.lookupMaybe(
      resourcesOf(document, page)?.get(PDFName.of('XObject')),
      PDFDict,
    );
    if (xobjects === undefined) continue;

    for (const [, value] of xobjects.entries()) {
      const stream = document.context.lookupMaybe(value, PDFStream);
      if (stream?.dict.get(PDFName.of('Alternates')) !== undefined) found += 1;
    }
  }
  return found;
}

/**
 * How many times the file has been written.
 *
 * Each save appends an end-of-file marker, so more than one means the earlier
 * revisions are still in the file. A full rewrite is what removes them, and
 * every PaperForge save is one.
 */
export function countRevisions(bytes: Uint8Array): number {
  return countOccurrences(bytes, '%%EOF');
}
