import { PDFName, PDFRawStream, type PDFDocument } from 'pdf-lib';

/**
 * Compressing what was written without compression.
 *
 * PaperForge's own edits write content streams as plain text so they can be
 * read back byte for byte, and plenty of other tools do the same. Deflate
 * loses nothing, so every stream without a filter is deflated — and kept
 * only if that made it smaller. Streams that have any filter are left as they
 * are: re-deflating them is qpdf's job, where it is installed.
 */

/** Below this, deflate's own overhead is about what it would save. */
const MIN_BYTES = 64;

export function compressStreams(document: PDFDocument): number {
  const { context } = document;
  let compressed = 0;

  for (const [ref, object] of context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue;
    const dict = object.dict;
    if (dict.has(PDFName.of('Filter')) || object.contents.length < MIN_BYTES) continue;
    // A cross-reference or object stream is written by pdf-lib itself, and
    // XMP is kept readable by tools that look for it without decoding.
    const type = dict.lookup(PDFName.of('Type'));
    if (type === PDFName.of('XRef') || type === PDFName.of('ObjStm')) continue;
    if (type === PDFName.of('Metadata')) continue;

    const deflated = context.flateStream(object.contents);
    if (deflated.contents.length >= object.contents.length) continue;

    for (const [key, value] of dict.entries()) {
      const name = key.decodeText();
      if (name === 'Length' || name === 'Filter' || name === 'DecodeParms') continue;
      deflated.dict.set(key, value);
    }
    context.assign(ref, deflated);
    compressed += 1;
  }
  return compressed;
}
