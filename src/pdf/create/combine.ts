import { PDFDocument, degrees, type PDFPage } from 'pdf-lib';
import { AppError } from '@shared/errors/appError';
import type { NewDocumentMetadata } from '@shared/schemas/create';
import { readOutline, writeOutline, type OutlineNode } from './outline';

/**
 * Putting documents together.
 *
 * Pages are copied into a new document — no source file is opened for writing,
 * let alone changed — and each source keeps its own order. Bookmarks can be
 * carried across: they are read as page indices in the source and written
 * again as pages of the result, so the ones whose pages were not taken simply
 * do not appear.
 */

export interface CombinePart {
  bytes: Uint8Array;
  /** Pages to take, one-based and in the order they should land. Null takes all. */
  pages: readonly number[] | null;
  /** Clockwise rotation added to every page taken from this source. */
  rotation: 0 | 90 | 180 | 270;
  /** What this source is called, for the bookmark naming it. */
  title: string;
}

export interface CombineOptions {
  /** A top-level bookmark for each source, named after the file. */
  bookmarkPerSource: boolean;
  /** Carry each source's own bookmarks across. */
  keepBookmarks: boolean;
  metadata: NewDocumentMetadata;
}

export interface CombineResult {
  bytes: Uint8Array;
  pageCount: number;
}

export async function combineDocuments(
  parts: readonly CombinePart[],
  options: CombineOptions,
): Promise<CombineResult> {
  if (parts.length === 0) {
    throw new AppError('internal/unexpected', {
      message: 'There are no documents to combine.',
    });
  }

  const target = await PDFDocument.create();
  const outline: OutlineNode[] = [];

  for (const part of parts) {
    const source = await load(part.bytes, part.title);
    const available = source.getPageCount();
    const wanted = (part.pages ?? everyPage(available)).filter(
      (page) => page >= 1 && page <= available,
    );
    if (wanted.length === 0) continue;

    const firstIndex = target.getPageCount();
    const copies = await target.copyPages(
      source,
      wanted.map((page) => page - 1),
    );
    copies.forEach((page) => {
      target.addPage(page);
      if (part.rotation !== 0) rotate(page, part.rotation);
    });

    // Where each page of the source ended up, so its bookmarks can follow.
    const landed = new Map<number, number>();
    wanted.forEach((page, offset) => {
      landed.set(page - 1, firstIndex + offset);
    });

    const carried = options.keepBookmarks ? translate(readOutline(source), landed) : [];
    if (options.bookmarkPerSource) {
      outline.push({ title: part.title, pageIndex: firstIndex, children: carried });
    } else {
      outline.push(...carried);
    }
  }

  if (target.getPageCount() === 0) {
    throw new AppError('internal/unexpected', {
      message: 'None of the pages chosen are in those documents.',
    });
  }

  if (options.metadata.title !== '') target.setTitle(options.metadata.title);
  if (options.metadata.author !== '') target.setAuthor(options.metadata.author);
  target.setProducer('PaperForge');
  target.setCreator('PaperForge');
  writeOutline(target, outline);

  return { bytes: await target.save({ useObjectStreams: true }), pageCount: target.getPageCount() };
}

function everyPage(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index + 1);
}

function rotate(page: PDFPage, added: number): void {
  const current = page.getRotation().angle;
  page.setRotation(degrees((((current + added) % 360) + 360) % 360));
}

/** Rewrites bookmarks in terms of the pages they landed on. */
function translate(
  nodes: readonly OutlineNode[],
  landed: ReadonlyMap<number, number>,
): OutlineNode[] {
  return nodes.map((node) => ({
    title: node.title,
    pageIndex: node.pageIndex === null ? null : (landed.get(node.pageIndex) ?? null),
    children: translate(node.children, landed),
  }));
}

async function load(bytes: Uint8Array, fileName: string): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/encrypt/i.test(message)) {
      throw new AppError('pdf/unsupported-encryption', {
        message: `${fileName} is encrypted, so its pages cannot be copied.`,
        cause: error,
      });
    }
    throw new AppError('pdf/invalid', {
      message: `${fileName} could not be read.`,
      details: message,
      cause: error,
    });
  }
}
