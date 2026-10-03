import { PDFDocument, StandardFonts } from 'pdf-lib';
import { pngPixel } from './images';

/**
 * Documents built to be large, for checking that the viewer's work and memory
 * stay bounded by what is on screen rather than by the length of the file.
 */

/** A text document of `pageCount` pages, each saying which page it is. */
export async function longDocument(pageCount: number): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const page = document.addPage([612, 792]);
    page.drawText(`Long document page ${pageNumber}`, { x: 72, y: 700, size: 18, font });
  }
  return document.save();
}

/**
 * A scan-like document: every page is one full-page picture of its own, at
 * roughly 200 dpi, with no text. Each picture is a solid shade so the file
 * stays small on disk, but every page still decodes to a full-size bitmap.
 */
export async function scannedBook(pageCount: number): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const pictures = new Map<number, Uint8Array>();
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const shade = 180 + (pageNumber % 60);
    const png = pictures.get(shade) ?? pngPixel(1700, 2200, [shade, shade, shade]);
    pictures.set(shade, png);
    const picture = await document.embedPng(png);
    const page = document.addPage([612, 792]);
    page.drawImage(picture, { x: 0, y: 0, width: 612, height: 792 });
  }
  return document.save();
}
