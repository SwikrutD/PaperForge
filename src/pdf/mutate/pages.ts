import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFString,
  type PDFPage,
} from 'pdf-lib';
import { AppError } from '@shared/errors/appError';
import type { EditOperation } from '@shared/schemas/edit';
import type { PageLabelStyle } from '@shared/schemas/pages';
import { normalizePages } from './operations';
import type { StagedAsset } from './types';

/**
 * The structural page operations: moving, duplicating, inserting, cropping and
 * numbering.
 *
 * They all work on a running order of pages held by the caller rather than on
 * indices asked of pdf-lib, because pdf-lib does not invalidate its page cache
 * when a page is removed.
 */

export interface PageContext {
  document: PDFDocument;
  /** The pages as they stand, which this module keeps up to date. */
  order: PDFPage[];
  /** Files staged for insertion, by the token the operation refers to. */
  assets: ReadonlyMap<string, StagedAsset>;
  /** Source documents already parsed, so a batch insert parses each once. */
  sources: Map<string, PDFDocument>;
}

/** The pages an operation names, as objects rather than numbers. */
function pagesFor(order: readonly PDFPage[], pages: readonly number[]): PDFPage[] {
  return normalizePages(pages, order.length).map((pageNumber) => order[pageNumber - 1] as PDFPage);
}

/** Puts a page into the document and into the running order together. */
function insertAt(context: PageContext, index: number, page: PDFPage): void {
  const at = Math.max(0, Math.min(index, context.order.length));
  context.document.insertPage(at, page);
  context.order.splice(at, 0, page);
}

function removeAt(context: PageContext, index: number): void {
  context.document.removePage(index);
  context.order.splice(index, 1);
}

/**
 * Moves pages to a new position.
 *
 * `toIndex` is counted in the document as it stands before the move, which is
 * what a drop indicator between two pages means. The pages keep their order
 * among themselves.
 */
export function movePages(context: PageContext, pages: readonly number[], toIndex: number): void {
  const moving = pagesFor(context.order, pages);
  if (moving.length === 0) return;

  const moved = new Set(moving);
  // Every page taken from before the target shifts the target left by one.
  const before = context.order
    .slice(0, Math.min(toIndex, context.order.length))
    .filter((page) => moved.has(page)).length;

  for (let index = context.order.length - 1; index >= 0; index -= 1) {
    if (moved.has(context.order[index] as PDFPage)) removeAt(context, index);
  }

  let target = Math.max(0, Math.min(toIndex - before, context.order.length));
  for (const page of moving) {
    insertAt(context, target, page);
    target += 1;
  }
}

/** Copies pages, each copy landing directly after its original. */
export async function duplicatePages(
  context: PageContext,
  pages: readonly number[],
): Promise<void> {
  const wanted = normalizePages(pages, context.order.length);
  if (wanted.length === 0) return;

  // Copying goes through the same machinery as copying from another document,
  // so the copy is a real page rather than a second reference to one.
  const copies = await context.document.copyPages(
    context.document,
    wanted.map((pageNumber) => pageNumber - 1),
  );

  // Highest first, so the earlier indices are still the pages they were. A
  // copy goes directly after its original, which is one past its index.
  for (let index = wanted.length - 1; index >= 0; index -= 1) {
    const copy = copies[index];
    if (copy !== undefined) insertAt(context, wanted[index] as number, copy);
  }
}

/** Adds empty pages, by default the size of the page they follow. */
export function insertBlankPages(
  context: PageContext,
  atIndex: number,
  count: number,
  size: { width: number; height: number } | null,
): void {
  const neighbour = context.order[Math.max(0, Math.min(atIndex, context.order.length) - 1)];
  const fallback = neighbour?.getSize() ?? { width: 595.28, height: 841.89 };
  const { width, height } = size ?? fallback;

  for (let index = 0; index < count; index += 1) {
    const at = Math.max(0, Math.min(atIndex + index, context.order.length));
    const page = context.document.insertPage(at, [width, height]);
    context.order.splice(at, 0, page);
  }
}

/** Reads a staged PDF once per transaction. */
async function sourceDocument(context: PageContext, token: string): Promise<PDFDocument> {
  const existing = context.sources.get(token);
  if (existing !== undefined) return existing;

  const asset = context.assets.get(token);
  if (asset === undefined || asset.kind !== 'pdf') {
    throw new AppError('internal/unexpected', {
      message: 'That document is no longer available to insert from.',
      details: `no staged PDF for ${token}`,
    });
  }

  const document = await PDFDocument.load(asset.bytes, { updateMetadata: false });
  context.sources.set(token, document);
  return document;
}

/** Inserts pages copied from another document. */
export async function insertPages(
  context: PageContext,
  atIndex: number,
  token: string,
  pages: readonly number[] | null,
): Promise<void> {
  const source = await sourceDocument(context, token);
  const available = source.getPageCount();
  const wanted =
    pages === null
      ? Array.from({ length: available }, (_, index) => index + 1)
      : normalizePages(pages, available);
  if (wanted.length === 0) return;

  const copies = await context.document.copyPages(
    source,
    wanted.map((pageNumber) => pageNumber - 1),
  );

  copies.forEach((page, offset) => {
    insertAt(context, atIndex + offset, page);
  });
}

/** Puts an image on a page of its own. */
export async function insertImagePages(
  context: PageContext,
  atIndex: number,
  token: string,
  size: { width: number; height: number } | null,
  margin: number,
): Promise<void> {
  const asset = context.assets.get(token);
  if (asset === undefined || asset.kind !== 'image') {
    throw new AppError('internal/unexpected', {
      message: 'That image is no longer available to add.',
      details: `no staged image for ${token}`,
    });
  }

  const embedded =
    asset.format === 'png'
      ? await context.document.embedPng(asset.bytes)
      : await context.document.embedJpg(asset.bytes);

  const pageSize = size ?? {
    width: embedded.width + margin * 2,
    height: embedded.height + margin * 2,
  };
  const at = Math.max(0, Math.min(atIndex, context.order.length));
  const page = context.document.insertPage(at, [pageSize.width, pageSize.height]);
  context.order.splice(at, 0, page);

  // The image keeps its proportions and sits in the middle of the page.
  const usableWidth = Math.max(1, pageSize.width - margin * 2);
  const usableHeight = Math.max(1, pageSize.height - margin * 2);
  const scale = Math.min(usableWidth / embedded.width, usableHeight / embedded.height, 1);
  const width = embedded.width * scale;
  const height = embedded.height * scale;

  page.drawImage(embedded, {
    x: (pageSize.width - width) / 2,
    y: (pageSize.height - height) / 2,
    width,
    height,
  });
}

/** Crops pages, or changes the page itself when that is what was asked for. */
export function cropPages(
  context: PageContext,
  pages: readonly number[],
  box: { x: number; y: number; width: number; height: number },
  target: 'crop' | 'media',
): void {
  for (const page of pagesFor(context.order, pages)) {
    const media = page.getMediaBox();
    // A box outside the page would hide the page altogether.
    const x = Math.max(media.x, Math.min(box.x, media.x + media.width));
    const y = Math.max(media.y, Math.min(box.y, media.y + media.height));
    const width = Math.max(1, Math.min(box.width, media.x + media.width - x));
    const height = Math.max(1, Math.min(box.height, media.y + media.height - y));

    if (target === 'media') page.setMediaBox(x, y, width, height);
    page.setCropBox(x, y, width, height);
  }
}

const LABEL_STYLES: Record<PageLabelStyle, string | null> = {
  decimal: 'D',
  romanLower: 'r',
  romanUpper: 'R',
  letterLower: 'a',
  letterUpper: 'A',
  none: null,
};

/**
 * Writes the document's page labels: what it prints on its pages, which is not
 * always the page's position.
 *
 * The entry for the chosen page is replaced and the others are kept, so
 * numbering a preface does not throw away the numbering of the body.
 */
export function setPageLabels(
  context: PageContext,
  fromPage: number,
  style: PageLabelStyle,
  prefix: string,
  start: number,
): void {
  const { document } = context;
  const catalog = document.catalog;
  const entries = readLabelEntries(document);

  const value: Record<string, PDFName | PDFString | number> = {};
  const styleName = LABEL_STYLES[style];
  if (styleName !== null) value['S'] = PDFName.of(styleName);
  if (prefix !== '') value['P'] = PDFString.of(prefix);
  if (start !== 1) value['St'] = start;

  const written = new Map<number, PDFDict | typeof value>(entries);
  written.set(Math.max(0, fromPage - 1), value);
  // A document with labels has to say what its first page is called.
  if (!written.has(0)) written.set(0, { S: PDFName.of('D') });

  const nums: unknown[] = [];
  for (const index of [...written.keys()].sort((a, b) => a - b)) {
    nums.push(index, written.get(index));
  }

  catalog.set(PDFName.of('PageLabels'), document.context.obj({ Nums: nums } as never));
}

/**
 * The entries already in `/PageLabels`, so they can be kept.
 *
 * A label tree split into `/Kids` — which only a very long document would have
 * — is not walked; those entries are replaced rather than merged, which the
 * organize workspace says when it offers to renumber.
 */
function readLabelEntries(document: PDFDocument): Map<number, PDFDict> {
  const entries = new Map<number, PDFDict>();
  const labels = document.catalog.lookup(PDFName.of('PageLabels'));
  if (!(labels instanceof PDFDict)) return entries;

  const nums = labels.lookup(PDFName.of('Nums'));
  if (!(nums instanceof PDFArray)) return entries;

  for (let index = 0; index + 1 < nums.size(); index += 2) {
    const key = nums.lookup(index);
    const value = nums.lookup(index + 1);
    if (key instanceof PDFNumber && value instanceof PDFDict) {
      entries.set(key.asNumber(), value);
    }
  }
  return entries;
}

/** Applies one page operation; returns false when it is not one. */
export async function applyPageOperation(
  context: PageContext,
  operation: EditOperation,
): Promise<boolean> {
  switch (operation.kind) {
    case 'movePages':
      movePages(context, operation.pages, operation.toIndex);
      return true;
    case 'duplicatePages':
      await duplicatePages(context, operation.pages);
      return true;
    case 'insertBlankPages':
      insertBlankPages(context, operation.atIndex, operation.count, operation.size);
      return true;
    case 'insertPages':
      await insertPages(context, operation.atIndex, operation.token, operation.pages);
      return true;
    case 'insertImagePages':
      await insertImagePages(
        context,
        operation.atIndex,
        operation.token,
        operation.size,
        operation.margin,
      );
      return true;
    case 'cropPages':
      cropPages(context, operation.pages, operation.box, operation.target);
      return true;
    case 'setPageLabels':
      setPageLabels(
        context,
        operation.fromPage,
        operation.style,
        operation.prefix,
        operation.start,
      );
      return true;
    default:
      return false;
  }
}
