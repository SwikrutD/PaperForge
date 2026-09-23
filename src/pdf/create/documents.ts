import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { AppError } from '@shared/errors/appError';
import type { NewDocumentMetadata, PageSetup } from '@shared/schemas/create';
import { wrapText } from '../text/layout';
import { contentBox, resolveSize, type Size } from './paper';

/**
 * Making a PDF out of something that is not one yet: nothing, a set of
 * images, or a text file.
 *
 * Each of these produces a complete document; putting several of them
 * together is `combine.ts`. What is drawn is deliberately plain — a PDF made
 * here should look like what it was made from, not like a layout PaperForge
 * invented.
 */

/** Where the size of a page comes from when the reader asked for "the image". */
const FALLBACK_PAGE: Size = { width: 595.28, height: 841.89 };

/** An image staged for a page, as the main process read it. */
export interface SourceImage {
  bytes: Uint8Array;
  format: 'png' | 'jpeg';
  fileName: string;
}

function applyMetadata(document: PDFDocument, metadata: NewDocumentMetadata): void {
  if (metadata.title !== '') document.setTitle(metadata.title);
  if (metadata.author !== '') document.setAuthor(metadata.author);
  document.setProducer('PaperForge');
  document.setCreator('PaperForge');
}

/** An empty document of a given size. */
export async function createBlank(options: {
  size: Size;
  pageCount: number;
  metadata: NewDocumentMetadata;
}): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  applyMetadata(document, options.metadata);

  for (let index = 0; index < Math.max(1, options.pageCount); index += 1) {
    document.addPage([options.size.width, options.size.height]);
  }
  return document.save({ useObjectStreams: true });
}

/**
 * One image per page.
 *
 * With a fixed paper size the image is fitted inside the margins, keeping its
 * proportions and never enlarged past its own resolution; with "the image's
 * own size" the page becomes the image plus its margins.
 */
export async function createFromImages(
  images: readonly SourceImage[],
  setup: PageSetup,
  metadata: NewDocumentMetadata,
): Promise<Uint8Array> {
  if (images.length === 0) {
    throw new AppError('internal/unexpected', { message: 'There are no images to make pages of.' });
  }

  const document = await PDFDocument.create();
  applyMetadata(document, metadata);
  const paper = resolveSize(setup.size);

  for (const image of images) {
    const embedded =
      image.format === 'png'
        ? await document.embedPng(image.bytes)
        : await document.embedJpg(image.bytes);

    const pageSize: Size =
      paper ??
      (embedded.width > 0 && embedded.height > 0
        ? { width: embedded.width + setup.margin * 2, height: embedded.height + setup.margin * 2 }
        : FALLBACK_PAGE);

    const page = document.addPage([pageSize.width, pageSize.height]);
    const box = contentBox(pageSize, setup);
    const scale = Math.min(box.width / embedded.width, box.height / embedded.height, 1);
    const width = embedded.width * scale;
    const height = embedded.height * scale;

    page.drawImage(embedded, {
      x: box.x + (box.width - width) / 2,
      y: box.y + (box.height - height) / 2,
      width,
      height,
    });
  }

  return document.save({ useObjectStreams: true });
}

export interface TextOptions {
  fontSize: number;
  /** Multiple of the font size between baselines. */
  lineHeight: number;
}

export const DEFAULT_TEXT_OPTIONS: TextOptions = { fontSize: 11, lineHeight: 1.4 };

/**
 * A text file, set in a monospaced font so that anything lined up with spaces
 * stays lined up. Lines too long for the page are wrapped rather than cut.
 */
export async function createFromText(
  text: string,
  setup: PageSetup,
  metadata: NewDocumentMetadata,
  options: TextOptions = DEFAULT_TEXT_OPTIONS,
): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  applyMetadata(document, metadata);

  const font = await document.embedFont(StandardFonts.Courier);
  const pageSize = resolveSize(setup.size) ?? FALLBACK_PAGE;
  const box = contentBox(pageSize, setup);
  const leading = options.fontSize * options.lineHeight;
  const perPage = Math.max(1, Math.floor(box.height / leading));

  const lines = wrapText(text === '' ? ' ' : text, font, options.fontSize, box.width);

  for (let start = 0; start < lines.length; start += perPage) {
    const page = document.addPage([pageSize.width, pageSize.height]);
    const slice = lines.slice(start, start + perPage);

    slice.forEach((line, index) => {
      if (line === '') return;
      page.drawText(line, {
        x: box.x,
        // The first baseline sits one line below the top of the text box.
        y: box.y + box.height - leading * (index + 1) + options.fontSize * 0.25,
        size: options.fontSize,
        font,
        color: rgb(0, 0, 0),
      });
    });
  }

  if (document.getPageCount() === 0) {
    document.addPage([pageSize.width, pageSize.height]);
  }
  return document.save({ useObjectStreams: true });
}
