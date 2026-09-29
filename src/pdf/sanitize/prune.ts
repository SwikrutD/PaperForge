import { PDFDict, PDFName, PDFRef, PDFStream, type PDFDocument, type PDFObject } from 'pdf-lib';

/**
 * Deleting objects, not just the references to them.
 *
 * pdf-lib writes every indirect object it holds, whether or not anything still
 * points at it. Dropping an entry from a name tree therefore hides an embedded
 * file without removing it — its bytes travel on into the saved document. For
 * an attachment that is untidy; for a redaction or a sanitize it would be a
 * lie. So anything PaperForge says it has removed is deleted from the object
 * graph as well.
 */

/** How deep an owned structure is followed before it is left alone. */
const MAX_DEPTH = 8;

/** Deletes the object a value refers to, if it refers to one at all. */
export function deleteReferenced(document: PDFDocument, value: PDFObject | undefined): void {
  if (value instanceof PDFRef) document.context.delete(value);
}

/**
 * Deletes a file specification and the embedded streams it owns.
 *
 * `keep` names the streams another specification still points at, so a file
 * carried twice under different names does not lose its bytes when one of the
 * two is removed.
 */
export function deleteFileSpec(
  document: PDFDocument,
  value: PDFObject | undefined,
  keep: ReadonlySet<string>,
): void {
  const spec = document.context.lookupMaybe(value, PDFDict);
  if (spec !== undefined) {
    const files = document.context.lookupMaybe(spec.get(PDFName.of('EF')), PDFDict);
    for (const streamRef of embeddedRefs(files)) {
      if (!keep.has(streamRef.toString())) document.context.delete(streamRef);
    }
  }
  deleteReferenced(document, value);
}

/** The streams a file specification's /EF names, as references. */
export function embeddedRefs(files: PDFDict | undefined): PDFRef[] {
  if (files === undefined) return [];
  const refs: PDFRef[] = [];
  for (const [, entry] of files.entries()) {
    if (entry instanceof PDFRef) refs.push(entry);
  }
  return refs;
}

/**
 * Deletes an action, the script it carries and everything its /Next chain
 * leads to. Nothing is executed on the way: this only follows references.
 */
export function deleteAction(document: PDFDocument, value: PDFObject | undefined, depth = 0): void {
  if (depth > MAX_DEPTH) return;

  const action = document.context.lookupMaybe(value, PDFDict);
  if (action !== undefined) {
    // A long script is kept in a stream of its own rather than a string.
    deleteReferenced(document, action.get(PDFName.of('JS')));
    deleteAction(document, action.get(PDFName.of('Next')), depth + 1);
  }
  deleteReferenced(document, value);
}

/** Deletes an annotation and the appearance streams only it uses. */
export function deleteAnnotation(document: PDFDocument, value: PDFObject | undefined): void {
  const annotation = document.context.lookupMaybe(value, PDFDict);
  if (annotation !== undefined) {
    const appearances = document.context.lookupMaybe(annotation.get(PDFName.of('AP')), PDFDict);
    for (const [, state] of appearances?.entries() ?? []) {
      if (state instanceof PDFRef) {
        // A state can be a stream directly, or a dictionary of them.
        const resolved = document.context.lookup(state);
        if (resolved instanceof PDFDict && !(resolved instanceof PDFStream)) {
          for (const [, nested] of resolved.entries()) deleteReferenced(document, nested);
        }
        document.context.delete(state);
      }
    }
  }
  deleteReferenced(document, value);
}
