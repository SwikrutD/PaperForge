import {
  PDFArray,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFString,
  type PDFDocument,
  type PDFObject,
} from 'pdf-lib';

/** How deep a name tree is followed before it is treated as malformed. */
const MAX_DEPTH = 32;

export interface NameTreeEntry {
  name: string;
  /** What the name points at, normally a reference to a dictionary. */
  value: PDFObject;
}

/**
 * Name trees, which is how a PDF keeps a sorted map from strings to objects.
 *
 * A tree can be one node or a balanced set of kids; both are read here, and
 * both are written back as a single node, which is valid and far easier to
 * reason about than rebalancing somebody else's tree.
 */
export function readNameTree(document: PDFDocument, root: PDFDict | undefined): NameTreeEntry[] {
  const entries: NameTreeEntry[] = [];
  if (root !== undefined) collect(document, root, entries, 0);
  return entries;
}

function collect(document: PDFDocument, node: PDFDict, into: NameTreeEntry[], depth: number): void {
  if (depth > MAX_DEPTH) return;

  const names = document.context.lookupMaybe(node.get(PDFName.of('Names')), PDFArray);
  if (names !== undefined) {
    for (let index = 0; index + 1 < names.size(); index += 2) {
      const key = names.lookup(index);
      if (key instanceof PDFString || key instanceof PDFHexString) {
        into.push({ name: key.decodeText(), value: names.get(index + 1) });
      }
    }
  }

  const kids = document.context.lookupMaybe(node.get(PDFName.of('Kids')), PDFArray);
  if (kids === undefined) return;
  for (let index = 0; index < kids.size(); index += 1) {
    const kid = document.context.lookupMaybe(kids.get(index), PDFDict);
    if (kid !== undefined) collect(document, kid, into, depth + 1);
  }
}

/**
 * Writes a name tree as one node with every entry in it, sorted by name as the
 * specification requires. An empty set removes the tree altogether.
 */
export function writeNameTree(
  document: PDFDocument,
  parent: PDFDict,
  key: string,
  entries: readonly NameTreeEntry[],
): void {
  if (entries.length === 0) {
    parent.delete(PDFName.of(key));
    return;
  }

  const sorted = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const array = PDFArray.withContext(document.context);
  for (const entry of sorted) {
    array.push(PDFHexString.fromText(entry.name));
    array.push(entry.value);
  }

  const node = document.context.obj({});
  node.set(PDFName.of('Names'), array);
  parent.set(PDFName.of(key), document.context.register(node));
}

/** The catalogue's /Names dictionary, made if the document has none. */
export function namesDictionary(document: PDFDocument): PDFDict {
  const existing = document.context.lookupMaybe(document.catalog.get(PDFName.of('Names')), PDFDict);
  if (existing !== undefined) return existing;

  const dict = document.context.obj({});
  document.catalog.set(PDFName.of('Names'), document.context.register(dict));
  return dict;
}
