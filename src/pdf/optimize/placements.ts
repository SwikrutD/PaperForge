import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  decodePDFRawStream,
  type PDFDocument,
} from 'pdf-lib';
import { parseContent } from '../content/parser';
import { contentBytes, resourcesOf } from '../content/pageContent';
import { multiply, walkContent, type Matrix } from '../content/state';
import { nameOf } from '../content/values';

/**
 * How large each picture is drawn.
 *
 * A picture's resolution is not a property of the picture: it is its pixels
 * divided by the size the page draws it at, and the same picture can be drawn
 * at several sizes. This walks every page — and every group a page draws —
 * and keeps, for each picture, the largest size it is drawn at, which is the
 * one that needs the most pixels.
 *
 * A picture drawn somewhere this walk does not reach (an annotation's
 * appearance, a pattern, a Type 3 glyph) cannot be measured, and is reported
 * as such so that it is never made smaller on a guess.
 */

export interface DrawnSize {
  /** The largest width and height the picture is drawn at, in points. */
  width: number;
  height: number;
}

export interface PictureUse {
  /** Pictures measured, by object reference. */
  measured: Map<string, DrawnSize>;
  /** Pictures drawn somewhere that could not be measured. */
  unmeasured: Set<string>;
}

/** Groups inside groups: deeper than this is malformed or malicious. */
const MAX_DEPTH = 12;

export function measurePictures(document: PDFDocument): PictureUse {
  const { context } = document;
  const measured = new Map<string, DrawnSize>();
  const walked = new Set<PDFDict>();

  const record = (ref: string, ctm: Matrix): void => {
    const width = Math.hypot(ctm.a, ctm.b);
    const height = Math.hypot(ctm.c, ctm.d);
    const known = measured.get(ref);
    measured.set(ref, {
      width: Math.max(known?.width ?? 0, width),
      height: Math.max(known?.height ?? 0, height),
    });
  };

  const walk = (
    bytes: Uint8Array,
    resources: PDFDict | undefined,
    ctm: Matrix,
    depth: number,
  ): void => {
    if (resources !== undefined) walked.add(resources);
    const xobjects = context.lookupMaybe(resources?.get(PDFName.of('XObject')), PDFDict);
    if (xobjects === undefined) return;

    walkContent(parseContent(bytes), {
      ctm,
      onOperation: ({ operation, state }) => {
        if (operation.operator !== 'Do') return;
        const name = nameOf(operation.operands[0]);
        if (name === null) return;
        const value = xobjects.get(PDFName.of(name));
        if (!(value instanceof PDFRef)) return;
        const stream = context.lookup(value);
        if (!(stream instanceof PDFStream)) return;

        const subtype = stream.dict.lookup(PDFName.of('Subtype'));
        if (subtype === PDFName.of('Image')) {
          record(value.toString(), state.ctm);
          return;
        }
        if (subtype !== PDFName.of('Form') || depth >= MAX_DEPTH) return;

        const formResources =
          context.lookupMaybe(stream.dict.get(PDFName.of('Resources')), PDFDict) ?? resources;
        const content = streamBytes(stream);
        if (content === null) return;
        walk(content, formResources, multiply(formMatrix(stream), state.ctm), depth + 1);
      },
    });
  };

  for (const page of document.getPages()) {
    walk(contentBytes(document, page), resourcesOf(document, page), identity(), 0);
  }

  // Anything else that lists pictures in resources of its own draws them
  // somewhere this walk did not go.
  const unmeasured = new Set<string>();
  for (const [, object] of context.enumerateIndirectObjects()) {
    const dict =
      object instanceof PDFStream ? object.dict : object instanceof PDFDict ? object : null;
    if (dict === null) continue;
    const resources = context.lookupMaybe(dict.get(PDFName.of('Resources')), PDFDict);
    if (resources === undefined || walked.has(resources)) continue;
    const xobjects = context.lookupMaybe(resources.get(PDFName.of('XObject')), PDFDict);
    for (const [, value] of xobjects?.entries() ?? []) {
      if (value instanceof PDFRef) unmeasured.add(value.toString());
    }
  }

  return { measured, unmeasured };
}

function identity(): Matrix {
  return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
}

function formMatrix(stream: PDFStream): Matrix {
  const matrix = stream.dict.lookup(PDFName.of('Matrix'));
  if (!(matrix instanceof PDFArray) || matrix.size() !== 6) return identity();
  const values = matrix
    .asArray()
    .map((entry) => (entry instanceof PDFNumber ? entry.asNumber() : Number.NaN));
  if (values.some((value) => !Number.isFinite(value))) return identity();
  const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = values;
  return { a, b, c, d, e, f };
}

function streamBytes(stream: PDFStream): Uint8Array | null {
  try {
    return stream instanceof PDFRawStream
      ? decodePDFRawStream(stream).decode()
      : stream.getContents();
  } catch {
    return null;
  }
}
