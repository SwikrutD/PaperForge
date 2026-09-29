import {
  PDFArray,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
  decodePDFRawStream,
  type PDFDocument,
} from 'pdf-lib';
import { isRiskyAttachmentName, type EmbeddedFile } from '@shared/schemas/attachment';
import { parsePdfDate } from '../metadata/read';
import { namesDictionary, readNameTree } from './nameTree';

/**
 * Files carried inside a document.
 *
 * A PDF can hold them in two places: the catalogue's embedded-files name tree,
 * which is what "attachments" normally means, and a file attachment annotation
 * pinned to a page. Both are listed, because a reader clearing a document of
 * carried files should not have one of them quietly left behind.
 *
 * Nothing here opens or runs an attachment. Bytes are only ever handed back
 * when the reader has asked for them by name.
 */

/** Marks an attachment that lives on a page rather than in the name tree. */
const ANNOTATION_PREFIX = '#annotation/';

export interface AttachmentRecord {
  file: EmbeddedFile;
  /** The file specification dictionary the entry points at. */
  spec: PDFDict;
}

export function readAttachments(document: PDFDocument): AttachmentRecord[] {
  const records: AttachmentRecord[] = [];
  const seen = new Set<string>();

  const tree = document.context.lookupMaybe(
    namesDictionaryMaybe(document)?.get(PDFName.of('EmbeddedFiles')),
    PDFDict,
  );

  for (const entry of readNameTree(document, tree)) {
    const spec = document.context.lookupMaybe(entry.value, PDFDict);
    if (spec === undefined || seen.has(entry.name)) continue;
    seen.add(entry.name);
    records.push({ file: describe(document, entry.name, spec), spec });
  }

  document.getPages().forEach((page, pageIndex) => {
    const annotations = document.context.lookupMaybe(page.node.get(PDFName.of('Annots')), PDFArray);
    if (annotations === undefined) return;

    for (let index = 0; index < annotations.size(); index += 1) {
      const annotation = document.context.lookupMaybe(annotations.get(index), PDFDict);
      if (annotation === undefined) continue;
      if (annotation.lookup(PDFName.of('Subtype')) !== PDFName.of('FileAttachment')) continue;

      const spec = document.context.lookupMaybe(annotation.get(PDFName.of('FS')), PDFDict);
      if (spec === undefined) continue;

      const id = `${ANNOTATION_PREFIX}${String(pageIndex)}/${String(index)}`;
      if (seen.has(id)) continue;
      seen.add(id);
      records.push({ file: describe(document, id, spec), spec });
    }
  });

  return records;
}

/** The bytes of one attachment, decoded. Null when it carries no stream. */
export function readAttachmentBytes(document: PDFDocument, spec: PDFDict): Uint8Array | null {
  const stream = embeddedStream(document, spec);
  if (stream === undefined) return null;
  return stream instanceof PDFRawStream
    ? decodePDFRawStream(stream).decode()
    : stream.getContents();
}

/** Finds one attachment by the id a listing gave it. */
export function findAttachment(document: PDFDocument, id: string): AttachmentRecord | undefined {
  return readAttachments(document).find((record) => record.file.id === id);
}

export function isAnnotationAttachment(id: string): boolean {
  return id.startsWith(ANNOTATION_PREFIX);
}

/** Page index and annotation index of an attachment pinned to a page. */
export function annotationLocation(id: string): { page: number; index: number } | null {
  if (!isAnnotationAttachment(id)) return null;
  const [page, index] = id.slice(ANNOTATION_PREFIX.length).split('/');
  const pageNumber = Number.parseInt(page ?? '', 10);
  const annotationIndex = Number.parseInt(index ?? '', 10);
  if (!Number.isInteger(pageNumber) || !Number.isInteger(annotationIndex)) return null;
  return { page: pageNumber, index: annotationIndex };
}

function namesDictionaryMaybe(document: PDFDocument): PDFDict | undefined {
  return document.context.lookupMaybe(document.catalog.get(PDFName.of('Names')), PDFDict);
}

function describe(document: PDFDocument, id: string, spec: PDFDict): EmbeddedFile {
  const fileName =
    textOf(spec.lookup(PDFName.of('UF'))) ?? textOf(spec.lookup(PDFName.of('F'))) ?? 'Unnamed file';
  const stream = embeddedStream(document, spec);
  const params = document.context.lookupMaybe(stream?.dict.get(PDFName.of('Params')), PDFDict);

  return {
    id: id.slice(0, 500),
    fileName: fileName.slice(0, 500),
    description: textOf(spec.lookup(PDFName.of('Desc'))),
    sizeBytes: sizeOf(stream, params),
    mimeType: nameOf(stream?.dict.lookup(PDFName.of('Subtype'))),
    createdAt: dateOf(params, 'CreationDate'),
    modifiedAt: dateOf(params, 'ModDate'),
    risky: isRiskyAttachmentName(fileName),
  };
}

/** The embedded file stream, preferring the Unicode slot the way readers do. */
function embeddedStream(document: PDFDocument, spec: PDFDict): PDFStream | undefined {
  const files = document.context.lookupMaybe(spec.get(PDFName.of('EF')), PDFDict);
  if (files === undefined) return undefined;

  for (const key of ['UF', 'F', 'DOS', 'Mac', 'Unix'] as const) {
    const entry = files.get(PDFName.of(key));
    if (entry === undefined) continue;
    const stream = document.context.lookupMaybe(entry, PDFStream);
    if (stream !== undefined) return stream;
  }
  return undefined;
}

/**
 * The declared size, or the stream's own length when nothing is compressing
 * it. A compressed stream's length says how much space it takes, not how big
 * the file is, so it is not offered as an answer.
 */
function sizeOf(stream: PDFStream | undefined, params: PDFDict | undefined): number | null {
  const declared = params?.lookup(PDFName.of('Size'));
  if (declared instanceof PDFNumber) return Math.max(0, Math.round(declared.asNumber()));
  if (stream === undefined) return null;
  if (stream.dict.get(PDFName.of('Filter')) !== undefined) return null;

  try {
    return stream.getContents().length;
  } catch {
    return null;
  }
}

function dateOf(params: PDFDict | undefined, key: string): string | null {
  const value = params?.lookup(PDFName.of(key));
  const text = textOf(value);
  if (text === null) return null;
  const parsed = parsePdfDate(text);
  return parsed === null ? null : parsed.toISOString();
}

function textOf(value: unknown): string | null {
  if (!(value instanceof PDFString || value instanceof PDFHexString)) return null;
  const text = value.decodeText();
  return text === '' ? null : text;
}

function nameOf(value: unknown): string | null {
  return value instanceof PDFName ? value.decodeText() : null;
}

/** The catalogue's /Names dictionary, made when a first file is embedded. */
export function embeddedFilesParent(document: PDFDocument): PDFDict {
  return namesDictionary(document);
}

/** True when a value is a reference, which removal has to compare by identity. */
export function isRef(value: unknown): value is PDFRef {
  return value instanceof PDFRef;
}
