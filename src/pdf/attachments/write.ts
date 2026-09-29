import {
  PDFArray,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFString,
  type PDFDocument,
} from 'pdf-lib';
import { AppError } from '@shared/errors/appError';
import type { EditOperation } from '@shared/schemas/edit';
import type { StagedAsset } from '../mutate/types';
import { deleteAnnotation, deleteFileSpec, embeddedRefs } from '../sanitize/prune';
import { namesDictionary, readNameTree, writeNameTree, type NameTreeEntry } from './nameTree';
import { annotationLocation, isAnnotationAttachment, readAttachments } from './read';

/**
 * Adding files to a document and taking them out again.
 *
 * An added file is embedded whole, with its name, size and modification time,
 * and is listed in the catalogue's embedded-files name tree — the place every
 * reader looks. Removing one takes out both the listing and the stream, and
 * the full rewrite that follows leaves the bytes nowhere in the new file.
 */

export function applyAttachmentOperation(
  document: PDFDocument,
  operation: EditOperation,
  assets: ReadonlyMap<string, StagedAsset>,
): boolean {
  if (operation.kind === 'addAttachments') {
    for (const token of operation.tokens) {
      const asset = assets.get(token);
      if (asset === undefined || asset.kind !== 'file') {
        throw new AppError('internal/unexpected', {
          message: 'That file is no longer staged to be attached.',
          details: token,
        });
      }
      embedFile(document, asset);
    }
    return true;
  }

  if (operation.kind === 'removeAttachments') {
    removeAttachments(document, operation.ids);
    return true;
  }

  return false;
}

/** Embeds one staged file, replacing an entry of the same name. */
export function embedFile(
  document: PDFDocument,
  asset: Extract<StagedAsset, { kind: 'file' }>,
): void {
  const stream = document.context.flateStream(asset.bytes, {
    Type: 'EmbeddedFile',
    ...(asset.mimeType === null ? {} : { Subtype: asset.mimeType }),
  });

  // /Params is where a reader learns the real size, since the stream itself is
  // compressed, and the date the file had before it was carried in here.
  const params = document.context.obj({});
  params.set(PDFName.of('Size'), PDFNumber.of(asset.bytes.length));
  params.set(PDFName.of('ModDate'), PDFString.fromDate(asset.modifiedAt));
  stream.dict.set(PDFName.of('Params'), params);

  const streamRef = document.context.register(stream);

  const files = document.context.obj({});
  files.set(PDFName.of('F'), streamRef);
  files.set(PDFName.of('UF'), streamRef);

  const spec = document.context.obj({});
  spec.set(PDFName.of('Type'), PDFName.of('Filespec'));
  spec.set(PDFName.of('F'), PDFString.of(asciiName(asset.fileName)));
  spec.set(PDFName.of('UF'), PDFHexString.fromText(asset.fileName));
  spec.set(PDFName.of('EF'), files);

  const names = namesDictionary(document);
  const tree = document.context.lookupMaybe(names.get(PDFName.of('EmbeddedFiles')), PDFDict);
  const existing = readNameTree(document, tree);
  const entries = existing.filter((entry) => entry.name !== asset.fileName);

  // A file of the same name is replaced, which means its old bytes go too.
  for (const replaced of existing.filter((entry) => entry.name === asset.fileName)) {
    deleteFileSpec(document, replaced.value, keptStreams(document, entries));
  }

  entries.push({ name: asset.fileName, value: document.context.register(spec) });

  writeNameTree(document, names, 'EmbeddedFiles', entries);
  markAsCarryingFiles(document);
}

/** Takes the named attachments out, wherever the document keeps them. */
export function removeAttachments(document: PDFDocument, ids: readonly string[]): number {
  const wanted = new Set(ids);
  let removed = 0;

  const names = document.context.lookupMaybe(document.catalog.get(PDFName.of('Names')), PDFDict);
  if (names !== undefined) {
    const tree = document.context.lookupMaybe(names.get(PDFName.of('EmbeddedFiles')), PDFDict);
    const entries = readNameTree(document, tree);
    const kept: NameTreeEntry[] = entries.filter((entry) => !wanted.has(entry.name));
    removed += entries.length - kept.length;

    if (kept.length !== entries.length) {
      writeNameTree(document, names, 'EmbeddedFiles', kept);
      // The listing is only half of it: the streams themselves have to go, or
      // the bytes travel on into the saved file.
      const keep = keptStreams(document, kept);
      for (const entry of entries.filter((candidate) => wanted.has(candidate.name))) {
        deleteFileSpec(document, entry.value, keep);
      }
    }
  }

  // Attachments pinned to a page are annotations, removed highest index first
  // so the ones still to go keep the positions their ids name.
  const byPage = new Map<number, number[]>();
  for (const id of wanted) {
    const location = annotationLocation(id);
    if (location === null) continue;
    const list = byPage.get(location.page) ?? [];
    list.push(location.index);
    byPage.set(location.page, list);
  }

  const pages = document.getPages();
  for (const [pageIndex, indexes] of byPage) {
    const page = pages[pageIndex];
    if (page === undefined) continue;
    const annotations = document.context.lookupMaybe(page.node.get(PDFName.of('Annots')), PDFArray);
    if (annotations === undefined) continue;

    for (const index of [...indexes].sort((a, b) => b - a)) {
      if (index < 0 || index >= annotations.size()) continue;

      const annotation = document.context.lookupMaybe(annotations.get(index), PDFDict);
      deleteFileSpec(document, annotation?.get(PDFName.of('FS')), new Set());
      deleteAnnotation(document, annotations.get(index));
      annotations.remove(index);
      removed += 1;
    }
  }

  return removed;
}

/** Removes every embedded file there is, for the sanitizer. */
export function removeAllAttachments(document: PDFDocument): number {
  return removeAttachments(
    document,
    readAttachments(document).map((record) => record.file.id),
  );
}

/** True when any id names an attachment that lives on a page. */
export function includesAnnotationAttachment(ids: readonly string[]): boolean {
  return ids.some(isAnnotationAttachment);
}

/** The embedded streams the entries that stay still point at. */
function keptStreams(
  document: PDFDocument,
  entries: readonly NameTreeEntry[],
): ReadonlySet<string> {
  const refs = new Set<string>();
  for (const entry of entries) {
    const spec = document.context.lookupMaybe(entry.value, PDFDict);
    const files = document.context.lookupMaybe(spec?.get(PDFName.of('EF')), PDFDict);
    for (const ref of embeddedRefs(files)) refs.add(ref.toString());
  }
  return refs;
}

/**
 * Declares that the document carries files, which is what tells a reader to
 * show its attachments pane when the file is opened.
 */
function markAsCarryingFiles(document: PDFDocument): void {
  const existing = document.catalog.lookup(PDFName.of('PageMode'));
  if (existing === undefined) {
    document.catalog.set(PDFName.of('PageMode'), PDFName.of('UseAttachments'));
  }
}

/**
 * /F holds the name in PDFDocEncoding, so anything outside it is replaced;
 * /UF carries the real name and is what a reader shows.
 */
function asciiName(fileName: string): string {
  return fileName.replace(/[^ -~]/g, '_');
}
