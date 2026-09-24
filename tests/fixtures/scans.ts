import { PDFDocument } from 'pdf-lib';

/**
 * Documents that are pictures of words rather than words.
 *
 * A scan is what OCR is for, and a test needs one whose words are known. The
 * picture is drawn by the window — a canvas can write text, and Node cannot —
 * and this turns it into a PDF with nothing on the page but that picture.
 */

export interface ScanOptions {
  /** The PNG of the page, as bytes. */
  image: Uint8Array;
  /** The page size in PDF units. US Letter by default. */
  width?: number;
  height?: number;
}

/** A one-page PDF whose only content is the given picture, filling the page. */
export async function buildScannedPdf(options: ScanOptions): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const width = options.width ?? 612;
  const height = options.height ?? 792;

  const page = document.addPage([width, height]);
  const picture = await document.embedPng(options.image);
  page.drawImage(picture, { x: 0, y: 0, width, height });

  return document.save();
}
