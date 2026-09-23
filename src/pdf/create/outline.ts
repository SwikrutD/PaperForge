import {
  PDFArray,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
  type PDFDocument,
  type PDFPage,
} from 'pdf-lib';

/**
 * Bookmarks, read from a document and written into one.
 *
 * pdf-lib has no outline API, so this reads and writes the dictionaries
 * directly. Reading resolves a destination to a page index, which is what
 * survives pages being copied into another document; writing points each entry
 * at a page of the document being built.
 */

export interface OutlineNode {
  title: string;
  /** Page the entry goes to, or null when its destination cannot be resolved. */
  pageIndex: number | null;
  children: OutlineNode[];
}

/** Deep enough for any real document, shallow enough to stop a malformed one. */
const MAX_DEPTH = 32;

export function readOutline(document: PDFDocument): OutlineNode[] {
  const outlines = document.catalog.lookup(PDFName.of('Outlines'));
  if (!(outlines instanceof PDFDict)) return [];

  const pageIndexes = pageIndexByRef(document);
  const names = destinationNames(document);
  const first = outlines.get(PDFName.of('First'));
  return readSiblings(document, first, { pageIndexes, names, seen: new Set(), depth: 0 });
}

interface ReadContext {
  pageIndexes: Map<string, number>;
  names: Map<string, unknown>;
  seen: Set<string>;
  depth: number;
}

function readSiblings(document: PDFDocument, first: unknown, context: ReadContext): OutlineNode[] {
  const nodes: OutlineNode[] = [];
  if (context.depth > MAX_DEPTH) return nodes;

  let current = first;
  while (current instanceof PDFRef) {
    const key = current.toString();
    // An outline that points back at itself would otherwise never end.
    if (context.seen.has(key)) break;
    context.seen.add(key);

    const item = document.context.lookup(current);
    if (!(item instanceof PDFDict)) break;

    nodes.push({
      title: titleOf(item),
      pageIndex: resolvePage(document, destinationOf(item), context),
      children: readSiblings(document, item.get(PDFName.of('First')), {
        ...context,
        depth: context.depth + 1,
      }),
    });

    current = item.get(PDFName.of('Next'));
  }
  return nodes;
}

function titleOf(item: PDFDict): string {
  const title = item.lookup(PDFName.of('Title'));
  if (title instanceof PDFString || title instanceof PDFHexString) {
    return title.decodeText().trim();
  }
  return 'Untitled';
}

/** The destination of an entry, whether it is written directly or as an action. */
function destinationOf(item: PDFDict): unknown {
  const direct = item.lookup(PDFName.of('Dest'));
  if (direct !== undefined) return direct;

  const action = item.lookup(PDFName.of('A'));
  if (!(action instanceof PDFDict)) return undefined;
  const kind = action.lookup(PDFName.of('S'));
  // Only "go to a page in this document" is a destination; a link or a launch
  // action is deliberately not followed.
  if (!(kind instanceof PDFName) || kind.asString() !== '/GoTo') return undefined;
  return action.lookup(PDFName.of('D'));
}

function resolvePage(
  document: PDFDocument,
  destination: unknown,
  context: ReadContext,
): number | null {
  if (destination instanceof PDFString || destination instanceof PDFHexString) {
    const named = context.names.get(destination.decodeText());
    return named === undefined
      ? null
      : resolvePage(document, named, { ...context, names: new Map() });
  }
  if (destination instanceof PDFName) {
    const named = context.names.get(destination.decodeText());
    return named === undefined
      ? null
      : resolvePage(document, named, { ...context, names: new Map() });
  }

  const array =
    destination instanceof PDFArray
      ? destination
      : destination instanceof PDFDict
        ? destination.lookup(PDFName.of('D'))
        : undefined;
  if (!(array instanceof PDFArray) || array.size() === 0) return null;

  const target = array.get(0);
  if (target instanceof PDFRef) {
    return context.pageIndexes.get(target.toString()) ?? null;
  }
  // A destination may also name the page by its index.
  if (target instanceof PDFNumber) {
    const index = target.asNumber();
    return Number.isInteger(index) && index >= 0 ? index : null;
  }
  return null;
}

function pageIndexByRef(document: PDFDocument): Map<string, number> {
  const indexes = new Map<string, number>();
  document.getPages().forEach((page, index) => {
    indexes.set(page.ref.toString(), index);
  });
  return indexes;
}

/**
 * Named destinations, from both places a PDF may keep them: the older
 * `/Dests` dictionary and the `/Names /Dests` name tree.
 */
function destinationNames(document: PDFDocument): Map<string, unknown> {
  const found = new Map<string, unknown>();

  const dests = document.catalog.lookup(PDFName.of('Dests'));
  if (dests instanceof PDFDict) {
    for (const [key, value] of dests.entries()) {
      found.set(key.decodeText(), document.context.lookupMaybe(value, PDFArray) ?? value);
    }
  }

  const names = document.catalog.lookup(PDFName.of('Names'));
  if (names instanceof PDFDict) {
    const tree = names.lookup(PDFName.of('Dests'));
    if (tree instanceof PDFDict) collectNameTree(document, tree, found, 0);
  }
  return found;
}

function collectNameTree(
  document: PDFDocument,
  node: PDFDict,
  into: Map<string, unknown>,
  depth: number,
): void {
  if (depth > MAX_DEPTH) return;

  const entries = node.lookup(PDFName.of('Names'));
  if (entries instanceof PDFArray) {
    for (let index = 0; index + 1 < entries.size(); index += 2) {
      const key = entries.lookup(index);
      if (key instanceof PDFString || key instanceof PDFHexString) {
        into.set(key.decodeText(), entries.lookup(index + 1));
      }
    }
  }

  const kids = node.lookup(PDFName.of('Kids'));
  if (kids instanceof PDFArray) {
    for (let index = 0; index < kids.size(); index += 1) {
      const kid = kids.lookup(index);
      if (kid instanceof PDFDict) collectNameTree(document, kid, into, depth + 1);
    }
  }
}

/**
 * Writes an outline into a document, replacing whatever it had.
 *
 * An entry whose page is missing is dropped and its children take its place,
 * so a bookmark for a page that was not taken does not take its section's
 * bookmarks with it.
 */
export function writeOutline(document: PDFDocument, nodes: readonly OutlineNode[]): void {
  const pages = document.getPages();
  const usable = prune(nodes, pages.length);
  const catalog = document.catalog;

  if (usable.length === 0) {
    catalog.delete(PDFName.of('Outlines'));
    return;
  }

  const rootRef = document.context.nextRef();
  const root = document.context.obj({ Type: 'Outlines' });
  const { firstRef, lastRef, total } = writeSiblings(document, usable, rootRef, pages);

  root.set(PDFName.of('First'), firstRef);
  root.set(PDFName.of('Last'), lastRef);
  root.set(PDFName.of('Count'), PDFNumber.of(total));
  document.context.assign(rootRef, root);
  catalog.set(PDFName.of('Outlines'), rootRef);
}

/** Drops entries that point nowhere, promoting their children in their place. */
function prune(nodes: readonly OutlineNode[], pageCount: number): OutlineNode[] {
  const kept: OutlineNode[] = [];
  for (const node of nodes) {
    const children = prune(node.children, pageCount);
    const valid = node.pageIndex !== null && node.pageIndex >= 0 && node.pageIndex < pageCount;
    if (valid) kept.push({ title: node.title, pageIndex: node.pageIndex, children });
    else kept.push(...children);
  }
  return kept;
}

interface WrittenSiblings {
  firstRef: PDFRef;
  lastRef: PDFRef;
  /** Entries written here and below, which is what `/Count` reports. */
  total: number;
}

function writeSiblings(
  document: PDFDocument,
  nodes: readonly OutlineNode[],
  parentRef: PDFRef,
  pages: readonly PDFPage[],
): WrittenSiblings {
  const refs = nodes.map(() => document.context.nextRef());
  let total = 0;

  nodes.forEach((node, index) => {
    const ref = refs[index] as PDFRef;
    const page = pages[node.pageIndex ?? 0];
    const item = document.context.obj({
      Title: PDFHexString.fromText(node.title === '' ? 'Untitled' : node.title),
      Parent: parentRef,
    });

    if (page !== undefined) {
      // "Top of the page, at the reader's current zoom" — the destination a
      // bookmark almost always wants.
      item.set(
        PDFName.of('Dest'),
        document.context.obj([page.ref, PDFName.of('XYZ'), null, page.getSize().height, null]),
      );
    }

    const previous = refs[index - 1];
    const next = refs[index + 1];
    if (previous !== undefined) item.set(PDFName.of('Prev'), previous);
    if (next !== undefined) item.set(PDFName.of('Next'), next);

    total += 1;
    if (node.children.length > 0) {
      const children = writeSiblings(document, node.children, ref, pages);
      item.set(PDFName.of('First'), children.firstRef);
      item.set(PDFName.of('Last'), children.lastRef);
      // A positive count means the entry starts open, showing its children.
      item.set(PDFName.of('Count'), PDFNumber.of(children.total));
      total += children.total;
    }

    document.context.assign(ref, item);
  });

  return {
    firstRef: refs[0] as PDFRef,
    lastRef: refs[refs.length - 1] as PDFRef,
    total,
  };
}
