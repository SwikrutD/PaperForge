import { PDFDict, PDFName, PDFRawStream, type PDFDocument } from 'pdf-lib';
import type { OptimizeAnalysis, OptimizeReport, OptimizeSettings } from '@shared/schemas/optimize';
import { hasXmpMetadata, isLinearized } from '../metadata/read';
import { collectGarbage } from '../redact/garbage';
import { sanitize } from '../sanitize/apply';
import { drawnDpi, listPictures, optimizePictures } from './images';
import { measurePictures } from './placements';
import type { ImageCodec } from './pixels';
import { compressStreams } from './streams';

/**
 * Optimising a document, in the order that makes each step count: what is
 * removed first is not then compressed, and objects only become unused once
 * pictures have been replaced and thumbnails taken away.
 */
export function optimizeDocument(
  document: PDFDocument,
  settings: OptimizeSettings,
  codec: ImageCodec | null,
): OptimizeReport {
  const thumbnails = settings.removeThumbnails ? countThumbnails(document) : 0;
  if (settings.removeThumbnails) sanitize(document, ['thumbnails']);

  const hadMetadata = hasMetadata(document);
  if (settings.removeMetadata) sanitize(document, ['metadata', 'xmpMetadata']);

  const pictures = optimizePictures(document, settings, measurePictures(document), codec);
  const objectsRemoved = settings.removeUnused ? collectGarbage(document) : 0;
  const streamsCompressed = settings.compressStreams ? compressStreams(document) : 0;

  return {
    imagesResampled: pictures.resampled,
    imagesRecompressed: pictures.recompressed,
    imagesConverted: pictures.converted,
    imagesGreyed: pictures.greyed,
    imagesKept: pictures.kept,
    streamsCompressed,
    thumbnailsRemoved: thumbnails,
    metadataRemoved: settings.removeMetadata && hadMetadata,
    objectsRemoved,
  };
}

/** What the document holds that the settings could act on. */
export function analyzeDocument(
  document: PDFDocument,
  bytes: Uint8Array,
): Omit<OptimizeAnalysis, 'qpdfAvailable'> {
  const use = measurePictures(document);
  const pictures = listPictures(document);
  let highest: number | null = null;
  for (const picture of pictures) {
    if (picture.kind === 'untouchable') continue;
    const dpi = drawnDpi(picture, use.measured.get(picture.ref.toString()));
    if (dpi !== null) highest = Math.max(highest ?? 0, dpi);
  }

  let uncompressed = 0;
  for (const [, object] of document.context.enumerateIndirectObjects()) {
    if (object instanceof PDFRawStream && !object.dict.has(PDFName.of('Filter'))) uncompressed += 1;
  }

  return {
    sizeBytes: bytes.byteLength,
    pageCount: document.getPageCount(),
    images: {
      total: pictures.length,
      bytes: pictures.reduce((total, picture) => total + picture.storedBytes, 0),
      jpeg: pictures.filter((picture) => picture.kind === 'jpeg').length,
      lossless: pictures.filter((picture) => picture.kind === 'lossless').length,
      untouchable: pictures.filter((picture) => picture.kind === 'untouchable').length,
      highestDpi: highest === null ? null : Math.round(highest),
    },
    uncompressedStreams: uncompressed,
    thumbnails: countThumbnails(document),
    hasMetadata: hasMetadata(document),
    linearized: isLinearized(bytes),
  };
}

function countThumbnails(document: PDFDocument): number {
  return document.getPages().filter((page) => page.node.get(PDFName.of('Thumb')) !== undefined)
    .length;
}

function hasMetadata(document: PDFDocument): boolean {
  const info = document.context.lookupMaybe(document.context.trailerInfo.Info, PDFDict);
  return (info !== undefined && info.keys().length > 0) || hasXmpMetadata(document);
}
