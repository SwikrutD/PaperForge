import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFRef,
  PDFStream,
  type PDFDocument,
  type PDFObject,
} from 'pdf-lib';
import { parseContent } from '../content/parser';
import { contentBytes, resourcesOf } from '../content/pageContent';
import { nameOf } from '../content/values';

/**
 * Making sure what was removed is not still in the file.
 *
 * pdf-lib writes every object it holds, referenced or not, so content taken
 * off a page would otherwise travel on into the saved document — invisible,
 * but one text extractor away. Two passes stop that: a picture or group a
 * redaction took off a page is deleted outright unless another page still
 * draws it, and then everything nothing reaches any more is deleted too.
 */

/**
 * Deletes every object the document no longer reaches from its trailer.
 * Returns how many were deleted.
 */
export function collectGarbage(document: PDFDocument): number {
  const { context } = document;
  const reached = new Set<string>();
  const pending: PDFObject[] = [];

  const trailer = context.trailerInfo;
  for (const root of [trailer.Root, trailer.Info, trailer.Encrypt, trailer.ID]) {
    if (root !== undefined) pending.push(root);
  }

  while (pending.length > 0) {
    const value = pending.pop();
    if (value instanceof PDFRef) {
      const key = value.toString();
      if (reached.has(key)) continue;
      reached.add(key);
      const target = context.lookup(value);
      if (target !== undefined) pending.push(target);
    } else if (value instanceof PDFStream) {
      pending.push(value.dict);
    } else if (value instanceof PDFDict) {
      for (const [, entry] of value.entries()) pending.push(entry);
    } else if (value instanceof PDFArray) {
      pending.push(...value.asArray());
    }
  }

  let deleted = 0;
  for (const [ref] of context.enumerateIndirectObjects()) {
    if (reached.has(ref.toString())) continue;
    context.delete(ref);
    deleted += 1;
  }
  return deleted;
}

/**
 * Deletes pictures and groups that no page draws any more.
 *
 * A page's resources often list every picture in the document whether the
 * page draws it or not, which would keep a redacted picture reachable — and
 * so in the file — from a page that never showed it. So "still used" means
 * drawn by some page, or listed by a group or an appearance (which is not
 * read here, and is trusted to need it). Anything else is deleted, and the
 * names that pointed at it are taken out of every page's resources.
 */
export function retireXObjects(document: PDFDocument, candidates: ReadonlySet<string>): void {
  if (candidates.size === 0) return;
  const { context } = document;
  const used = new Set<string>();
  const listings: Array<{ dict: PDFDict; name: PDFName; ref: string }> = [];

  for (const page of document.getPages()) {
    const xobjects = context.lookupMaybe(
      resourcesOf(document, page)?.get(PDFName.of('XObject')),
      PDFDict,
    );
    if (xobjects === undefined) continue;

    const listed = new Map<string, string>();
    for (const [name, value] of xobjects.entries()) {
      if (!(value instanceof PDFRef) || !candidates.has(value.toString())) continue;
      listed.set(name.decodeText(), value.toString());
      listings.push({ dict: xobjects, name, ref: value.toString() });
    }
    if (listed.size === 0) continue;

    for (const operation of parseContent(contentBytes(document, page))) {
      if (operation.operator !== 'Do') continue;
      const ref = listed.get(nameOf(operation.operands[0]) ?? '');
      if (ref !== undefined) used.add(ref);
    }
  }

  // Groups and appearances draw with resources of their own.
  for (const [ref, object] of context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFStream) || candidates.has(ref.toString())) continue;
    const resources = context.lookupMaybe(object.dict.get(PDFName.of('Resources')), PDFDict);
    const xobjects = context.lookupMaybe(resources?.get(PDFName.of('XObject')), PDFDict);
    for (const [, value] of xobjects?.entries() ?? []) {
      if (value instanceof PDFRef && candidates.has(value.toString())) used.add(value.toString());
    }
  }

  for (const listing of listings) {
    if (!used.has(listing.ref)) listing.dict.delete(listing.name);
  }
  for (const [ref] of context.enumerateIndirectObjects()) {
    if (candidates.has(ref.toString()) && !used.has(ref.toString())) context.delete(ref);
  }
}
