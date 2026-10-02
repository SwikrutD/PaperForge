import {
  PDFArray,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFString,
  type PDFDocument,
} from 'pdf-lib';
import { AppError } from '@shared/errors/appError';
import type {
  BookmarkAction,
  BookmarkNode,
  BookmarkStyle,
  BookmarkTarget,
} from '@shared/schemas/bookmark';
import type { EditOperation } from '@shared/schemas/edit';
import { outlinePageResolver } from '../create/outline';
import {
  contains,
  isOpen,
  locate,
  readOutlineTree,
  writeOutlineTree,
  type OutlineEntry,
  type OutlineTree,
} from './outlineTree';

/**
 * Reading and editing bookmarks.
 *
 * PaperForge writes one kind of destination — a page of this document and a
 * height on it — and leaves every other kind alone: an entry that opens a web
 * address keeps doing so when it is renamed or moved, and only changes when
 * the reader points it somewhere else.
 */

const ITALIC = 1;
const BOLD = 2;

export function readBookmarks(document: PDFDocument): BookmarkNode[] {
  const resolve = outlinePageResolver(document);
  const describe = (entries: readonly OutlineEntry[], parent: string): BookmarkNode[] =>
    entries.map((entry, index) => {
      const path = parent === '' ? String(index) : `${parent}.${String(index)}`;
      const pageIndex = resolve(entry.dict);
      return {
        path,
        title: titleOf(entry.dict),
        page: pageIndex === null ? null : pageIndex + 1,
        action: actionOf(entry.dict, pageIndex),
        style: styleOf(entry.dict),
        open: isOpen(entry.dict),
        children: describe(entry.children, path),
      };
    });
  return describe(readOutlineTree(document).entries, '');
}

export function applyBookmarkOperation(document: PDFDocument, operation: EditOperation): boolean {
  switch (operation.kind) {
    case 'addBookmark': {
      const tree = readOutlineTree(document);
      const siblings =
        operation.parent === null ? tree.entries : entryAt(tree, operation.parent).entry.children;
      const dict = document.context.obj({});
      const entry: OutlineEntry = { ref: document.context.register(dict), dict, children: [] };
      setTitle(dict, operation.title);
      setStyle(dict, operation.style);
      setTarget(document, dict, operation.target);
      const index = Math.min(operation.index ?? siblings.length, siblings.length);
      siblings.splice(index, 0, entry);
      writeOutlineTree(document, tree);
      return true;
    }

    case 'updateBookmark': {
      const tree = readOutlineTree(document);
      const { entry } = entryAt(tree, operation.path, operation.expectTitle);
      if (operation.title !== null) setTitle(entry.dict, operation.title);
      if (operation.style !== null) setStyle(entry.dict, operation.style);
      if (operation.target !== null) setTarget(document, entry.dict, operation.target);
      if (operation.open !== null && entry.children.length > 0) {
        // The sign is all that matters here; writing the tree sets the number.
        entry.dict.set(PDFName.of('Count'), PDFNumber.of(operation.open ? 1 : -1));
      }
      writeOutlineTree(document, tree);
      return true;
    }

    case 'deleteBookmark': {
      const tree = readOutlineTree(document);
      const { siblings, index } = entryAt(tree, operation.path, operation.expectTitle);
      siblings.splice(index, 1);
      writeOutlineTree(document, tree);
      return true;
    }

    case 'moveBookmark': {
      const tree = readOutlineTree(document);
      const source = entryAt(tree, operation.path, operation.expectTitle);
      const parent = operation.parent === null ? null : entryAt(tree, operation.parent).entry;
      if (parent !== null && contains(source.entry, parent)) {
        throw new AppError('internal/unexpected', {
          message: 'A bookmark cannot be moved inside itself.',
          details: `moveBookmark: ${operation.path} into ${operation.parent ?? 'top'}`,
        });
      }
      const target = parent === null ? tree.entries : parent.children;

      // The index was chosen before the move, so taking the entry out of the
      // same list first shifts everything after it up by one.
      let index = Math.min(operation.index, target.length);
      if (target === source.siblings && source.index < index) index -= 1;
      source.siblings.splice(source.index, 1);
      target.splice(Math.min(index, target.length), 0, source.entry);
      writeOutlineTree(document, tree);
      return true;
    }

    default:
      return false;
  }
}

/** The entry at a path, refusing one that is not the entry the window meant. */
function entryAt(
  tree: OutlineTree,
  path: string,
  title?: string,
): NonNullable<ReturnType<typeof locate>> {
  const found = locate(tree, path);
  if (found === undefined || (title !== undefined && titleOf(found.entry.dict) !== title)) {
    throw new AppError('internal/unexpected', {
      message: 'The bookmarks have changed since they were shown. Try again.',
      details: `bookmark ${path}: expected "${title ?? ''}", found "${found === undefined ? 'nothing' : titleOf(found.entry.dict)}"`,
    });
  }
  return found;
}

function titleOf(dict: PDFDict): string {
  const title = dict.lookup(PDFName.of('Title'));
  if (title instanceof PDFString || title instanceof PDFHexString) return title.decodeText();
  return '';
}

function styleOf(dict: PDFDict): BookmarkStyle {
  const flags = dict.lookup(PDFName.of('F'));
  const bits = flags instanceof PDFNumber ? flags.asNumber() : 0;
  const color = dict.lookup(PDFName.of('C'));
  let parsed: BookmarkStyle['color'] = null;
  if (color instanceof PDFArray && color.size() >= 3) {
    const [r, g, b] = [0, 1, 2].map((index) => {
      const value = color.lookup(index);
      return value instanceof PDFNumber ? Math.min(1, Math.max(0, value.asNumber())) : 0;
    });
    // Black is what an entry without a colour looks like anyway.
    if ((r ?? 0) + (g ?? 0) + (b ?? 0) > 0) parsed = { r: r ?? 0, g: g ?? 0, b: b ?? 0 };
  }
  return { bold: (bits & BOLD) !== 0, italic: (bits & ITALIC) !== 0, color: parsed };
}

function actionOf(dict: PDFDict, pageIndex: number | null): BookmarkAction {
  if (pageIndex !== null) return 'page';
  const action = dict.lookup(PDFName.of('A'));
  if (action instanceof PDFDict) {
    const kind = action.lookup(PDFName.of('S'));
    return kind instanceof PDFName && kind.decodeText() === 'URI' ? 'url' : 'other';
  }
  return dict.has(PDFName.of('Dest')) ? 'other' : 'none';
}

function setTitle(dict: PDFDict, title: string): void {
  dict.set(PDFName.of('Title'), PDFHexString.fromText(title.trim() === '' ? 'Untitled' : title));
}

function setStyle(dict: PDFDict, style: BookmarkStyle): void {
  const bits = (style.bold ? BOLD : 0) | (style.italic ? ITALIC : 0);
  if (bits === 0) dict.delete(PDFName.of('F'));
  else dict.set(PDFName.of('F'), PDFNumber.of(bits));

  if (style.color === null) dict.delete(PDFName.of('C'));
  else {
    const { r, g, b } = style.color;
    dict.set(PDFName.of('C'), colorArray(dict, [r, g, b]));
  }
}

function colorArray(dict: PDFDict, values: number[]): PDFArray {
  const array = PDFArray.withContext(dict.context);
  for (const value of values) array.push(PDFNumber.of(Math.round(value * 1000) / 1000));
  return array;
}

/** Points an entry at a height on a page, keeping the reader's zoom. */
function setTarget(document: PDFDocument, dict: PDFDict, target: BookmarkTarget): void {
  const page = document.getPages()[target.page - 1];
  if (page === undefined) {
    throw new AppError('internal/unexpected', {
      message: 'That page is not in this document.',
      details: `bookmark target page ${String(target.page)} of ${String(document.getPageCount())}`,
    });
  }
  const top = target.top ?? page.getCropBox().y + page.getCropBox().height;
  dict.delete(PDFName.of('A'));
  dict.set(
    PDFName.of('Dest'),
    document.context.obj([page.ref, PDFName.of('XYZ'), null, Math.round(top * 100) / 100, null]),
  );
}
