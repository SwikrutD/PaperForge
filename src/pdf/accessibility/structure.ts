import {
  PDFArray,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
  type PDFDocument,
  type PDFObject,
} from 'pdf-lib';

/**
 * The tag tree: the structure a tagged PDF gives its content, which is what
 * a screen reader reads instead of the page's drawing.
 *
 * This reads the tree as it is. Nothing is inferred: an element is the type
 * the document says it is (after its role map), sits on the page the document
 * says, and owns the marked content the document assigns it.
 */

/** Deep enough for any real tree, shallow enough to stop a malformed one. */
const MAX_DEPTH = 64;
/** Enough for a long tagged report; a larger tree is reported as truncated. */
const MAX_ELEMENTS = 50_000;

/** Content an element owns on a page. */
export type StructureContent =
  | { kind: 'mcid'; pageIndex: number | null; mcid: number }
  | { kind: 'object'; pageIndex: number | null; ref: PDFRef };

export interface StructureElement {
  /** Indexes of structure elements from the root, joined with dots. */
  path: string;
  /** The type as written, e.g. "Heading1" in a document that maps its own names. */
  rawType: string;
  /** The standard type the role map resolves it to, e.g. "H1". */
  type: string;
  dict: PDFDict;
  /** The page the element says it is on, inherited from its ancestors. */
  pageIndex: number | null;
  alt: string | null;
  actualText: string | null;
  /** Marked content and objects the element owns directly, in order. */
  content: StructureContent[];
  children: StructureElement[];
}

export interface StructureTree {
  roots: StructureElement[];
  /** Every element, depth first, which is the tree's reading order. */
  elements: StructureElement[];
  truncated: boolean;
}

export function structTreeRoot(document: PDFDocument): PDFDict | undefined {
  return document.context.lookupMaybe(document.catalog.get(PDFName.of('StructTreeRoot')), PDFDict);
}

/** The tag tree, or null when the document has none. */
export function readStructureTree(document: PDFDocument): StructureTree | null {
  const root = structTreeRoot(document);
  if (root === undefined) return null;

  const pageIndexes = new Map<string, number>();
  document.getPages().forEach((page, index) => pageIndexes.set(page.ref.toString(), index));

  const context: ReadContext = {
    document,
    pageIndexes,
    roleMap: readRoleMap(document, root),
    seen: new Set(),
    elements: [],
    truncated: false,
  };

  const roots = readKids(context, root.get(PDFName.of('K')), '', null, 0).elements;
  return { roots, elements: context.elements, truncated: context.truncated };
}

interface ReadContext {
  document: PDFDocument;
  pageIndexes: Map<string, number>;
  roleMap: Map<string, string>;
  seen: Set<PDFDict>;
  elements: StructureElement[];
  truncated: boolean;
}

/** Reads a `/K` value: one kid or an array of them. */
function readKids(
  context: ReadContext,
  value: PDFObject | undefined,
  parentPath: string,
  pageIndex: number | null,
  depth: number,
): { elements: StructureElement[]; content: StructureContent[] } {
  const elements: StructureElement[] = [];
  const content: StructureContent[] = [];
  if (value === undefined || depth > MAX_DEPTH) return { elements, content };

  const kids: PDFObject[] = [];
  const resolved = context.document.context.lookup(value);
  if (resolved instanceof PDFArray) {
    for (let index = 0; index < resolved.size(); index += 1) kids.push(resolved.get(index));
  } else {
    kids.push(value);
  }

  for (const kid of kids) {
    const item = context.document.context.lookup(kid);

    if (item instanceof PDFNumber) {
      content.push({ kind: 'mcid', pageIndex, mcid: item.asNumber() });
      continue;
    }
    if (!(item instanceof PDFDict)) continue;

    const type = nameOf(item.lookup(PDFName.of('Type')));
    if (type === 'MCR') {
      const mcid = item.lookup(PDFName.of('MCID'));
      if (mcid instanceof PDFNumber) {
        content.push({
          kind: 'mcid',
          pageIndex: pageOf(context, item) ?? pageIndex,
          mcid: mcid.asNumber(),
        });
      }
      continue;
    }
    if (type === 'OBJR') {
      const ref = item.get(PDFName.of('Obj'));
      if (ref instanceof PDFRef) {
        content.push({ kind: 'object', pageIndex: pageOf(context, item) ?? pageIndex, ref });
      }
      continue;
    }

    // Anything else with an /S is a structure element.
    if (item.get(PDFName.of('S')) === undefined) continue;
    if (context.seen.has(item)) continue;
    if (context.elements.length >= MAX_ELEMENTS) {
      context.truncated = true;
      break;
    }
    context.seen.add(item);

    const path = parentPath === '' ? String(elements.length) : `${parentPath}.${elements.length}`;
    elements.push(readElement(context, item, path, pageIndex, depth));
  }

  return { elements, content };
}

function readElement(
  context: ReadContext,
  dict: PDFDict,
  path: string,
  inheritedPage: number | null,
  depth: number,
): StructureElement {
  const rawType = nameOf(dict.lookup(PDFName.of('S'))) ?? 'Unknown';
  const pageIndex = pageOf(context, dict) ?? inheritedPage;

  const element: StructureElement = {
    path,
    rawType,
    type: resolveRole(context.roleMap, rawType),
    dict,
    pageIndex,
    alt: textOf(dict.lookup(PDFName.of('Alt'))),
    actualText: textOf(dict.lookup(PDFName.of('ActualText'))),
    content: [],
    children: [],
  };
  // Depth first, parent before children: the order the tree is read in.
  context.elements.push(element);

  const kids = readKids(context, dict.get(PDFName.of('K')), path, pageIndex, depth + 1);
  element.content = kids.content;
  element.children = kids.elements;
  return element;
}

/** The element at a path, or undefined when the tree has no such element. */
export function elementAt(tree: StructureTree, path: string): StructureElement | undefined {
  const indexes = path.split('.').map((part) => Number.parseInt(part, 10));
  let level: readonly StructureElement[] = tree.roots;
  let found: StructureElement | undefined;
  for (const index of indexes) {
    found = level[index];
    if (found === undefined) return undefined;
    level = found.children;
  }
  return found;
}

/** Every page of every element under this one, including its own. */
export function pagesOf(element: StructureElement): Set<number> {
  const pages = new Set<number>();
  const visit = (current: StructureElement): void => {
    if (current.pageIndex !== null) pages.add(current.pageIndex);
    for (const item of current.content) if (item.pageIndex !== null) pages.add(item.pageIndex);
    current.children.forEach(visit);
  };
  visit(element);
  return pages;
}

function pageOf(context: ReadContext, dict: PDFDict): number | null {
  const page = dict.get(PDFName.of('Pg'));
  if (!(page instanceof PDFRef)) return null;
  return context.pageIndexes.get(page.toString()) ?? null;
}

function readRoleMap(document: PDFDocument, root: PDFDict): Map<string, string> {
  const map = new Map<string, string>();
  const roleMap = document.context.lookupMaybe(root.get(PDFName.of('RoleMap')), PDFDict);
  if (roleMap === undefined) return map;

  for (const [key, value] of roleMap.entries()) {
    const target = nameOf(document.context.lookup(value));
    if (target !== null) map.set(key.decodeText(), target);
  }
  return map;
}

/** Follows the role map to a standard type, stopping at a loop. */
function resolveRole(roleMap: ReadonlyMap<string, string>, type: string): string {
  let current = type;
  const seen = new Set<string>([current]);
  for (let step = 0; step < 16; step += 1) {
    const next = roleMap.get(current);
    if (next === undefined || seen.has(next)) break;
    seen.add(next);
    current = next;
  }
  return current;
}

function nameOf(value: unknown): string | null {
  return value instanceof PDFName ? value.decodeText() : null;
}

function textOf(value: unknown): string | null {
  if (value instanceof PDFString || value instanceof PDFHexString) return value.decodeText();
  return null;
}
