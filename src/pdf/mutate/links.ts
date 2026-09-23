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
import { AppError } from '@shared/errors/appError';
import type { EditOperation } from '@shared/schemas/edit';
import type { LinkModel, LinkRect, LinkTarget } from '@shared/schemas/link';

/**
 * The links a page carries, and the links PaperForge puts there.
 *
 * A link is a `/Link` annotation: a rectangle with either an address or a
 * destination in this document. PaperForge writes those two and leaves
 * everything else alone — a launch action or embedded JavaScript is described
 * to the reader, never followed and never rewritten.
 */

/** Marks a link PaperForge made, so it can be told from one that came with the file. */
const ADDED_PREFIX = 'PFLink';

/** What a reader sees of a link, plus where it is in the file. */
interface FoundLink {
  model: LinkModel;
  dict: PDFDict;
  index: number;
}

export function linksOnPage(document: PDFDocument, pageIndex: number): LinkModel[] {
  return findLinks(document, pageIndex).map((found) => found.model);
}

function findLinks(document: PDFDocument, pageIndex: number): FoundLink[] {
  const page = document.getPage(pageIndex);
  const annots = page.node.Annots();
  if (annots === undefined) return [];

  const found: FoundLink[] = [];
  for (let index = 0; index < annots.size(); index += 1) {
    const entry = annots.get(index);
    const dict = annots.lookup(index);
    if (!(dict instanceof PDFDict)) continue;

    const subtype = dict.lookup(PDFName.of('Subtype'));
    if (!(subtype instanceof PDFName) || subtype.decodeText() !== 'Link') continue;

    const rect = rectOf(dict);
    if (rect === null) continue;

    const name = stringOf(dict, 'NM');
    const id = name ?? (entry instanceof PDFRef ? entry.toString() : `link${String(index)}`);
    found.push({
      model: { id, rect, target: targetOf(document, dict), added: id.startsWith(ADDED_PREFIX) },
      dict,
      index,
    });
  }
  return found;
}

function rectOf(dict: PDFDict): LinkRect | null {
  const array = dict.lookup(PDFName.of('Rect'));
  if (!(array instanceof PDFArray) || array.size() < 4) return null;

  const numbers = [0, 1, 2, 3].map((index) => {
    const value = array.lookup(index);
    return value instanceof PDFNumber ? value.asNumber() : Number.NaN;
  });
  if (numbers.some((value) => !Number.isFinite(value))) return null;

  const [first = 0, second = 0, third = 0, fourth = 0] = numbers;
  const x = Math.min(first, third);
  const y = Math.min(second, fourth);
  return {
    x,
    y,
    width: Math.max(1, Math.abs(third - first)),
    height: Math.max(1, Math.abs(fourth - second)),
  };
}

/** Where a link goes, as far as PaperForge is prepared to say. */
function targetOf(document: PDFDocument, dict: PDFDict): LinkTarget {
  const action = dict.lookup(PDFName.of('A'));
  if (action instanceof PDFDict) {
    const kind = action.lookup(PDFName.of('S'));
    const name = kind instanceof PDFName ? kind.decodeText() : '';

    if (name === 'URI') {
      const uri = action.lookup(PDFName.of('URI'));
      const text = uri instanceof PDFString || uri instanceof PDFHexString ? uri.decodeText() : '';
      return text === ''
        ? { kind: 'other', description: 'An empty address' }
        : { kind: 'url', url: text };
    }

    if (name === 'GoTo') {
      const page = pageOfDestination(document, action.lookup(PDFName.of('D')));
      if (page !== null) return { kind: 'page', page };
      return { kind: 'other', description: 'A named destination in this document' };
    }

    // A launch action or document JavaScript is described, never run.
    return {
      kind: 'other',
      description:
        name === 'Launch'
          ? 'Opens a file on the computer'
          : name === 'JavaScript'
            ? 'Runs JavaScript in the document, which PaperForge does not do'
            : `An action of type ${name === '' ? 'unknown' : name}`,
    };
  }

  const page = pageOfDestination(document, dict.lookup(PDFName.of('Dest')));
  if (page !== null) return { kind: 'page', page };
  if (dict.has(PDFName.of('Dest'))) {
    return { kind: 'other', description: 'A named destination in this document' };
  }
  return { kind: 'other', description: 'Nowhere: the link has no destination' };
}

/** The page number an explicit destination array points at, if any. */
function pageOfDestination(document: PDFDocument, destination: unknown): number | null {
  if (!(destination instanceof PDFArray) || destination.size() === 0) return null;

  const target = destination.get(0);
  if (!(target instanceof PDFRef)) return null;

  const index = document.getPages().findIndex((page) => page.ref === target);
  return index < 0 ? null : index + 1;
}

function stringOf(dict: PDFDict, key: string): string | null {
  const value = dict.lookup(PDFName.of(key));
  if (value instanceof PDFString || value instanceof PDFHexString) return value.decodeText();
  return null;
}

/** Applies a link operation; returns false when it is not one. */
export function applyLinkOperation(document: PDFDocument, operation: EditOperation): boolean {
  if (
    operation.kind !== 'addLink' &&
    operation.kind !== 'updateLink' &&
    operation.kind !== 'deleteLink'
  ) {
    return false;
  }

  const pageIndex = operation.page - 1;
  if (pageIndex < 0 || pageIndex >= document.getPageCount()) {
    throw new AppError('internal/unexpected', {
      message: 'That page is not in this document any more.',
      details: `page ${String(operation.page)} of ${String(document.getPageCount())}`,
    });
  }
  const page = document.getPage(pageIndex);

  if (operation.kind === 'addLink') {
    writeLink(document, page, nextId(document), operation.rect, operation.target);
    return true;
  }

  const found = findLinks(document, pageIndex).find(
    (candidate) => candidate.model.id === operation.linkId,
  );
  if (found === undefined) {
    throw new AppError('pdf/malformed-content', {
      message: 'That link is no longer on the page.',
      details: `link ${operation.linkId} on page ${String(operation.page)}`,
    });
  }

  const annots = page.node.Annots();
  if (annots === undefined) return true;

  if (operation.kind === 'deleteLink') {
    annots.remove(found.index);
    return true;
  }

  // Changing where a link goes replaces it outright: what it pointed at may
  // have been an action PaperForge does not write, and none of it should be
  // left behind beside the new destination.
  annots.remove(found.index);
  writeLink(
    document,
    page,
    found.model.added ? found.model.id : nextId(document),
    operation.rect ?? found.model.rect,
    operation.target ?? found.model.target,
  );
  return true;
}

/** A name of PaperForge's own, unused anywhere in the document. */
function nextId(document: PDFDocument): string {
  const used = new Set<string>();
  for (let index = 0; index < document.getPageCount(); index += 1) {
    for (const link of linksOnPage(document, index)) used.add(link.id);
  }

  let number = 1;
  while (used.has(`${ADDED_PREFIX}${String(number)}`)) number += 1;
  return `${ADDED_PREFIX}${String(number)}`;
}

function writeLink(
  document: PDFDocument,
  page: PDFPage,
  id: string,
  rect: LinkRect,
  target: LinkTarget,
): void {
  if (target.kind === 'other') {
    throw new AppError('internal/unexpected', {
      message: 'PaperForge can point a link at a page or at a web address.',
      details: target.description,
    });
  }

  const destination =
    target.kind === 'url'
      ? { A: { Type: 'Action', S: 'URI', URI: PDFString.of(target.url) } }
      : {
          Dest: [
            document.getPage(Math.min(target.page, document.getPageCount()) - 1).ref,
            PDFName.of('Fit'),
          ],
        };

  const dict = document.context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height],
    NM: PDFString.of(id),
    // A link with no border is what a reader expects; the rectangle is the
    // clickable area, not a drawn box.
    Border: [0, 0, 0],
    F: 4,
    P: page.ref,
    ...destination,
  });
  page.node.addAnnot(document.context.register(dict));
}
