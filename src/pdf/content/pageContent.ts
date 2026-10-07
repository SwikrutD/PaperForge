import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFRawStream,
  PDFStream,
  decodePDFRawStream,
  type PDFDocument,
  type PDFPage,
} from 'pdf-lib';
import { parseContent, type ContentOperation } from './parser';
import { readPageFonts, type FontMetrics } from './fonts';
import { extractTextRuns, type TextRun } from './textRuns';
import {
  extractImages,
  type FormOpener,
  type ImageFacts,
  type ImagePlacement,
  type SkippedImageReason,
} from './images';

/**
 * A page's drawing, read for editing.
 *
 * A page may keep its content in several streams; PDF defines them as one
 * stream with whitespace between, and that is how they are read here — and
 * how they are written back, as a single stream. Every byte range in the
 * model therefore refers to this one buffer.
 */

export interface PageContent {
  pageIndex: number;
  /** The page's content, as one buffer. */
  bytes: Uint8Array;
  operations: ContentOperation[];
  fonts: Map<string, FontMetrics>;
  runs: TextRun[];
  /** The images the page draws, in the order it draws them. */
  images: ImagePlacement[];
  /** Pictures the page shows that are not offered for editing, and why. */
  skipped: SkippedImageReason[];
}

/** What the page's XObjects are; supplied by the caller, which has pdf-lib. */
export type XObjectReader = (
  document: PDFDocument,
  resources: PDFDict | undefined,
) => { images: Map<string, ImageFacts>; alphas: Map<string, number>; openForm?: FormOpener };

export async function readPageContent(
  document: PDFDocument,
  pageIndex: number,
  readXObjects?: XObjectReader,
): Promise<PageContent> {
  const page = document.getPage(pageIndex);
  const resources = resourcesOf(document, page);
  const bytes = contentBytes(document, page);
  const operations = parseContent(bytes);
  const fonts = await readPageFonts(document, resources);
  const runs = extractTextRuns(operations, { fonts: (name) => fonts.get(name) });

  const resourcesRead = readXObjects?.(document, resources);
  const skipped: SkippedImageReason[] = [];
  const images = extractImages(operations, (name) => resourcesRead?.images.get(name), {
    alphas: (name) => resourcesRead?.alphas.get(name),
    onSkipped: (reason) => skipped.push(reason),
    bytes,
    ...(resourcesRead?.openForm === undefined ? {} : { openForm: resourcesRead.openForm }),
  });

  return { pageIndex, bytes, operations, fonts, runs, images, skipped };
}

/** The page's resource dictionary, inherited from its parents when absent. */
export function resourcesOf(document: PDFDocument, page: PDFPage): PDFDict | undefined {
  let node: PDFDict | undefined = page.node;
  for (let depth = 0; depth < 32 && node !== undefined; depth += 1) {
    const resources = document.context.lookupMaybe(node.get(PDFName.of('Resources')), PDFDict);
    if (resources !== undefined) return resources;
    node = document.context.lookupMaybe(node.get(PDFName.of('Parent')), PDFDict);
  }
  return undefined;
}

/** Every content stream of a page, decoded and joined. */
export function contentBytes(document: PDFDocument, page: PDFPage): Uint8Array {
  const contents = page.node.get(PDFName.of('Contents'));
  const resolved = document.context.lookup(contents);

  const streams: Uint8Array[] = [];
  if (resolved instanceof PDFArray) {
    for (let index = 0; index < resolved.size(); index += 1) {
      const stream = document.context.lookup(resolved.get(index));
      const decoded = decodeStream(stream);
      if (decoded !== null) streams.push(decoded);
    }
  } else {
    const decoded = decodeStream(resolved);
    if (decoded !== null) streams.push(decoded);
  }

  if (streams.length === 0) return new Uint8Array(0);
  if (streams.length === 1) return streams[0] as Uint8Array;

  // A newline between streams, because an operator may end one stream and its
  // operands begin the next.
  const separator = new Uint8Array([0x0a]);
  const total = streams.reduce((sum, stream) => sum + stream.length + 1, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const stream of streams) {
    joined.set(stream, offset);
    offset += stream.length;
    joined.set(separator, offset);
    offset += 1;
  }
  return joined;
}

export function decodeStream(value: unknown): Uint8Array | null {
  if (!(value instanceof PDFStream)) return null;
  try {
    return value instanceof PDFRawStream ? decodePDFRawStream(value).decode() : value.getContents();
  } catch {
    // A stream PaperForge cannot decode is one it will not rewrite either.
    return null;
  }
}
