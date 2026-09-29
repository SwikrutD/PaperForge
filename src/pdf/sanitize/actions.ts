import { PDFArray, PDFDict, PDFName, type PDFDocument } from 'pdf-lib';
import { readNameTree } from '../attachments/nameTree';

/**
 * Finding the actions a document asks a reader to perform.
 *
 * PaperForge never performs one. They are collected so they can be listed and
 * removed — a document that says "run this script when you open me" is exactly
 * the hidden information the sanitizer exists to take out (CLAUDE.md
 * section 22).
 */

/** Actions that start a program, reach outside the file, or send data away. */
const REACHING_OUT = new Set([
  'Launch',
  'SubmitForm',
  'ImportData',
  'GoToR',
  'GoToE',
  'Movie',
  'Sound',
  'Rendition',
]);

/** How far a chain of /Next actions is followed. */
const MAX_CHAIN = 64;

export type ActionKind = 'javascript' | 'reachingOut' | 'other';

export interface ActionSite {
  /** The dictionary holding the entry, and the key to delete to remove it. */
  owner: PDFDict;
  key: PDFName;
  /** /S from the action, e.g. "JavaScript" or "Launch". */
  type: string;
  kind: ActionKind;
  /** Where it was found, for the report: "page 2 annotation", "on open". */
  where: string;
}

export function classifyAction(type: string): ActionKind {
  if (type === 'JavaScript') return 'javascript';
  return REACHING_OUT.has(type) ? 'reachingOut' : 'other';
}

/**
 * Every action the document attaches to itself, a page, an annotation or a
 * field, plus the document-level JavaScript name tree.
 */
export function collectActions(document: PDFDocument): ActionSite[] {
  const sites: ActionSite[] = [];

  const openAction = document.context.lookupMaybe(
    document.catalog.get(PDFName.of('OpenAction')),
    PDFDict,
  );
  if (openAction !== undefined) {
    record(document, sites, document.catalog, PDFName.of('OpenAction'), openAction, 'on open');
  }

  additionalActions(document, sites, document.catalog, 'document');

  for (const entry of javaScriptNameEntries(document)) {
    const action = document.context.lookupMaybe(entry.value, PDFDict);
    if (action === undefined) continue;
    record(
      document,
      sites,
      namesOwner(document) ?? document.catalog,
      PDFName.of('JavaScript'),
      action,
      `document script "${entry.name}"`,
    );
  }

  document.getPages().forEach((page, index) => {
    const label = `page ${String(index + 1)}`;
    additionalActions(document, sites, page.node, label);

    const annotations = document.context.lookupMaybe(page.node.get(PDFName.of('Annots')), PDFArray);
    if (annotations === undefined) return;

    for (let position = 0; position < annotations.size(); position += 1) {
      const annotation = document.context.lookupMaybe(annotations.get(position), PDFDict);
      if (annotation === undefined) continue;

      const action = document.context.lookupMaybe(annotation.get(PDFName.of('A')), PDFDict);
      if (action !== undefined) {
        record(document, sites, annotation, PDFName.of('A'), action, `${label} annotation`);
      }
      additionalActions(document, sites, annotation, `${label} annotation`);
    }
  });

  return sites;
}

/** The document-level JavaScript name tree, which is where startup scripts live. */
export function javaScriptNameEntries(document: PDFDocument): ReturnType<typeof readNameTree> {
  const names = namesOwner(document);
  if (names === undefined) return [];
  const tree = document.context.lookupMaybe(names.get(PDFName.of('JavaScript')), PDFDict);
  return readNameTree(document, tree);
}

export function namesOwner(document: PDFDocument): PDFDict | undefined {
  return document.context.lookupMaybe(document.catalog.get(PDFName.of('Names')), PDFDict);
}

/** /AA, which holds an action per trigger — open, close, print, keystroke. */
function additionalActions(
  document: PDFDocument,
  sites: ActionSite[],
  owner: PDFDict,
  where: string,
): void {
  const additional = document.context.lookupMaybe(owner.get(PDFName.of('AA')), PDFDict);
  if (additional === undefined) return;

  for (const [key, value] of additional.entries()) {
    const action = document.context.lookupMaybe(value, PDFDict);
    if (action === undefined) continue;
    record(document, sites, additional, key, action, `${where} (${key.decodeText()})`);
  }
}

/** Records an action and everything its /Next chain leads to. */
function record(
  document: PDFDocument,
  sites: ActionSite[],
  owner: PDFDict,
  key: PDFName,
  action: PDFDict,
  where: string,
): void {
  let current: PDFDict | undefined = action;

  for (let step = 0; step < MAX_CHAIN && current !== undefined; step += 1) {
    const type = nameOf(current.lookup(PDFName.of('S'))) ?? 'Unknown';
    sites.push({ owner, key, type, kind: classifyAction(type), where });

    // Only the head of a chain has an owner to delete from; removing it takes
    // the rest with it, so the tail is recorded for the report alone.
    current = document.context.lookupMaybe(current.get(PDFName.of('Next')), PDFDict);
  }
}

function nameOf(value: unknown): string | null {
  return value instanceof PDFName ? value.decodeText() : null;
}
