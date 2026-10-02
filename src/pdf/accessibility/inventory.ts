import {
  PDFDict,
  PDFName,
  PDFRawStream,
  PDFStream,
  decodePDFRawStream,
  type PDFDocument,
} from 'pdf-lib';
import { contentBytes, resourcesOf } from '../content/pageContent';
import { parseContent, type ContentOperation } from '../content/parser';

/**
 * What a page draws, counted rather than understood: how many times it shows
 * text and how many pictures it paints, through any groups it draws.
 *
 * A page that paints pictures and shows no text at all is almost always a
 * scan, and a scan says nothing to a screen reader until its words have been
 * recognised. Text drawn invisibly — the layer Recognize Text adds — counts as
 * text, because that is exactly what a reader needs.
 */

const SHOW_OPERATORS = new Set(['Tj', 'TJ', "'", '"']);
const MAX_FORM_DEPTH = 8;

export interface PageInventory {
  textShows: number;
  pictures: number;
}

export function pageInventory(document: PDFDocument, pageIndex: number): PageInventory {
  const page = document.getPage(pageIndex);
  const inventory: PageInventory = { textShows: 0, pictures: 0 };
  count(
    document,
    parseContent(contentBytes(document, page)),
    resourcesOf(document, page),
    inventory,
    0,
    new Set(),
  );
  return inventory;
}

function count(
  document: PDFDocument,
  operations: readonly ContentOperation[],
  resources: PDFDict | undefined,
  into: PageInventory,
  depth: number,
  visiting: Set<PDFStream>,
): void {
  const xobjects = document.context.lookupMaybe(resources?.get(PDFName.of('XObject')), PDFDict);

  for (const operation of operations) {
    if (SHOW_OPERATORS.has(operation.operator)) {
      if (showsSomething(operation)) into.textShows += 1;
      continue;
    }
    if (operation.operator === 'ID') {
      into.pictures += 1;
      continue;
    }
    if (operation.operator !== 'Do') continue;

    const name = operation.operands[0];
    if (name?.kind !== 'name' || xobjects === undefined) continue;
    const stream = document.context.lookup(xobjects.get(PDFName.of(name.value)));
    if (!(stream instanceof PDFStream)) continue;

    const subtype = stream.dict.lookup(PDFName.of('Subtype'));
    const kind = subtype instanceof PDFName ? subtype.decodeText() : '';
    if (kind === 'Image') {
      into.pictures += 1;
      continue;
    }
    if (kind !== 'Form' || depth >= MAX_FORM_DEPTH || visiting.has(stream)) continue;

    const bytes = decode(stream);
    if (bytes === null) continue;
    visiting.add(stream);
    const own = document.context.lookupMaybe(stream.dict.get(PDFName.of('Resources')), PDFDict);
    count(document, parseContent(bytes), own ?? resources, into, depth + 1, visiting);
    visiting.delete(stream);
  }
}

/** True when a show operation has at least one byte of text to show. */
function showsSomething(operation: ContentOperation): boolean {
  return operation.operands.some((operand) => {
    if (operand.kind === 'string') return operand.bytes.length > 0;
    if (operand.kind === 'array') {
      return operand.items.some((item) => item.kind === 'string' && item.bytes.length > 0);
    }
    return false;
  });
}

function decode(stream: PDFStream): Uint8Array | null {
  try {
    return stream instanceof PDFRawStream
      ? decodePDFRawStream(stream).decode()
      : stream.getContents();
  } catch {
    return null;
  }
}
