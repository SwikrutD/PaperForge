import { PDFDict, PDFName, PDFNumber, PDFRef, type PDFDocument } from 'pdf-lib';

/**
 * The outline as a tree of dictionaries, for changing it in place.
 *
 * PDF keeps an outline as linked lists — `/First`, `/Last`, `/Next`, `/Prev`,
 * `/Parent` and a `/Count` on every level. Rather than patch those links one
 * operation at a time, PaperForge reads the lists into arrays, changes the
 * arrays, and writes every link again. Each entry keeps its own dictionary,
 * so whatever else it carries — an action PaperForge does not write, a
 * structure element, another program's private keys — survives the edit.
 */

const MAX_DEPTH = 32;
const MAX_ENTRIES = 10_000;

export interface OutlineEntry {
  ref: PDFRef;
  dict: PDFDict;
  children: OutlineEntry[];
}

export interface OutlineTree {
  rootRef: PDFRef | null;
  root: PDFDict | null;
  entries: OutlineEntry[];
}

export function readOutlineTree(document: PDFDocument): OutlineTree {
  const rootValue = document.catalog.get(PDFName.of('Outlines'));
  const root = document.context.lookupMaybe(rootValue, PDFDict) ?? null;
  if (root === null) return { rootRef: null, root: null, entries: [] };

  const seen = new Set<string>();
  const count = { value: 0 };
  return {
    rootRef: rootValue instanceof PDFRef ? rootValue : null,
    root,
    entries: readLevel(document, root.get(PDFName.of('First')), seen, count, 0),
  };
}

function readLevel(
  document: PDFDocument,
  first: unknown,
  seen: Set<string>,
  count: { value: number },
  depth: number,
): OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  if (depth > MAX_DEPTH) return entries;

  let current = first;
  while (current instanceof PDFRef && count.value < MAX_ENTRIES) {
    const key = current.toString();
    // An outline that points back at itself would otherwise never end.
    if (seen.has(key)) break;
    seen.add(key);

    const dict = document.context.lookup(current);
    if (!(dict instanceof PDFDict)) break;
    count.value += 1;

    entries.push({
      ref: current,
      dict,
      children: readLevel(document, dict.get(PDFName.of('First')), seen, count, depth + 1),
    });
    current = dict.get(PDFName.of('Next'));
  }
  return entries;
}

/** The entry at a path, with the list it sits in and its place there. */
export function locate(
  tree: OutlineTree,
  path: string,
): { entry: OutlineEntry; siblings: OutlineEntry[]; index: number } | undefined {
  const indexes = path.split('.').map((part) => Number.parseInt(part, 10));
  let siblings = tree.entries;
  let found: { entry: OutlineEntry; siblings: OutlineEntry[]; index: number } | undefined;

  for (const index of indexes) {
    const entry = siblings[index];
    if (entry === undefined) return undefined;
    found = { entry, siblings, index };
    siblings = entry.children;
  }
  return found;
}

/** True when an entry starts open, showing its children. */
export function isOpen(dict: PDFDict): boolean {
  const count = dict.lookup(PDFName.of('Count'));
  return count instanceof PDFNumber && count.asNumber() > 0;
}

/**
 * Writes every link of the tree again, from the arrays.
 *
 * `/Count` follows the specification: on an open entry, the number of
 * entries that show beneath it; on a closed one, the negative of the number
 * that would show if it were opened; on the root, every entry that shows.
 * An empty tree takes the outline off the document.
 */
export function writeOutlineTree(document: PDFDocument, tree: OutlineTree): void {
  if (tree.entries.length === 0) {
    document.catalog.delete(PDFName.of('Outlines'));
    return;
  }

  let rootRef = tree.rootRef;
  let root = tree.root;
  if (rootRef === null || root === null) {
    root = root ?? document.context.obj({ Type: 'Outlines' });
    rootRef = document.context.register(root);
  }
  document.catalog.set(PDFName.of('Outlines'), rootRef);

  const visible = linkLevel(root, rootRef, tree.entries);
  root.set(PDFName.of('Count'), PDFNumber.of(visible));
}

/** Links one level under its parent and returns how many entries of it show. */
function linkLevel(parent: PDFDict, parentRef: PDFRef, entries: readonly OutlineEntry[]): number {
  const first = entries[0];
  const last = entries[entries.length - 1];
  if (first === undefined || last === undefined) {
    for (const key of ['First', 'Last', 'Count']) parent.delete(PDFName.of(key));
    return 0;
  }
  parent.set(PDFName.of('First'), first.ref);
  parent.set(PDFName.of('Last'), last.ref);

  let shown = 0;
  entries.forEach((entry, index) => {
    const { dict } = entry;
    dict.set(PDFName.of('Parent'), parentRef);
    const previous = entries[index - 1];
    const next = entries[index + 1];
    if (previous === undefined) dict.delete(PDFName.of('Prev'));
    else dict.set(PDFName.of('Prev'), previous.ref);
    if (next === undefined) dict.delete(PDFName.of('Next'));
    else dict.set(PDFName.of('Next'), next.ref);

    const open = isOpen(dict) || (entry.children.length > 0 && !dict.has(PDFName.of('Count')));
    const beneath = linkLevel(dict, entry.ref, entry.children);
    if (entry.children.length > 0) {
      dict.set(PDFName.of('Count'), PDFNumber.of(open ? beneath : -beneath));
    }
    shown += 1 + (open ? beneath : 0);
  });
  return shown;
}

/** Every entry beneath this one, and itself — for refusing to drop an entry into itself. */
export function contains(entry: OutlineEntry, candidate: OutlineEntry): boolean {
  if (entry === candidate) return true;
  return entry.children.some((child) => contains(child, candidate));
}
