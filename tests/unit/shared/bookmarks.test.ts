import { describe, expect, it } from 'vitest';
import { PDFDict, PDFDocument, PDFName, type PDFNumber } from 'pdf-lib';
import { PdfLibMutationEngine } from '../../../src/pdf/mutate/pdfLibEngine';
import type { BookmarkNode } from '../../../src/shared/schemas/bookmark';
import type { EditOperation } from '../../../src/shared/schemas/edit';
import { buildPdf } from '../../fixtures/pdf';

const engine = new PdfLibMutationEngine();
const PLAIN = { bold: false, italic: false, color: null };

/** Chapter One (1) > [Section A (2), Section B (3)], Chapter Two (4). */
function outlined(): Buffer {
  return buildPdf({
    pages: [{}, {}, {}, {}],
    outline: [
      {
        title: 'Chapter One',
        page: 1,
        children: [
          { title: 'Section A', page: 2 },
          { title: 'Section B', page: 3, bold: true, color: [0.8, 0, 0] },
        ],
      },
      { title: 'Chapter Two', page: 4, italic: true },
    ],
  });
}

async function edit(bytes: Uint8Array, operations: EditOperation[]): Promise<Uint8Array> {
  return (await engine.apply(bytes, operations)).bytes;
}

/** "Title (page)" at each level, which is what a reader sees. */
function shape(nodes: readonly BookmarkNode[]): unknown[] {
  return nodes.map((node) =>
    node.children.length === 0
      ? `${node.title} (${String(node.page)})`
      : [`${node.title} (${String(node.page)})`, shape(node.children)],
  );
}

/** Every Prev/Next/Parent link agrees with the order the entries are read in. */
async function linksAreConsistent(bytes: Uint8Array): Promise<boolean> {
  const document = await PDFDocument.load(bytes);
  const check = (parent: PDFDict): boolean => {
    let current = parent.get(PDFName.of('First'));
    let previous: unknown;
    let last: unknown;
    while (current !== undefined) {
      const item = document.context.lookup(current, PDFDict);
      if (item.get(PDFName.of('Prev')) !== previous) return false;
      if (document.context.lookup(item.get(PDFName.of('Parent'))) !== parent) return false;
      if (!check(item)) return false;
      previous = current;
      last = current;
      current = item.get(PDFName.of('Next'));
    }
    return parent.get(PDFName.of('Last')) === last;
  };
  const root = document.catalog.lookupMaybe(PDFName.of('Outlines'), PDFDict);
  return root === undefined || check(root);
}

describe('bookmarks', () => {
  it('reads the outline with its pages, styles and nesting', async () => {
    const bookmarks = await engine.readBookmarks(outlined());

    expect(shape(bookmarks)).toEqual([
      ['Chapter One (1)', ['Section A (2)', 'Section B (3)']],
      'Chapter Two (4)',
    ]);
    expect(bookmarks[0]?.children[1]).toMatchObject({
      path: '0.1',
      action: 'page',
      style: { bold: true, italic: false, color: { r: 0.8, g: 0, b: 0 } },
    });
    expect(bookmarks[1]?.style.italic).toBe(true);
  });

  it('adds a bookmark where it is asked, to a page and a height on it', async () => {
    const bytes = await edit(outlined(), [
      {
        kind: 'addBookmark',
        parent: '0',
        index: 1,
        title: 'Introduction to B',
        target: { page: 3, top: 400 },
        style: PLAIN,
      },
      {
        kind: 'addBookmark',
        parent: null,
        index: null,
        title: 'Appendix',
        target: { page: 4, top: null },
        style: { bold: true, italic: false, color: { r: 0, g: 0, b: 1 } },
      },
    ]);

    expect(shape(await engine.readBookmarks(bytes))).toEqual([
      ['Chapter One (1)', ['Section A (2)', 'Introduction to B (3)', 'Section B (3)']],
      'Chapter Two (4)',
      'Appendix (4)',
    ]);
    expect(await linksAreConsistent(bytes)).toBe(true);

    const document = await PDFDocument.load(bytes);
    const root = document.catalog.lookup(PDFName.of('Outlines'), PDFDict);
    // Three top-level entries, one of them open on three children.
    expect((root.lookup(PDFName.of('Count')) as PDFNumber).asNumber()).toBe(6);
  });

  it('renames, restyles and re-points an entry, keeping everything else', async () => {
    const bytes = await edit(outlined(), [
      {
        kind: 'updateBookmark',
        path: '1',
        expectTitle: 'Chapter Two',
        title: 'Chapter 2',
        style: PLAIN,
        target: { page: 2, top: 300 },
        open: null,
      },
    ]);
    const [, second] = await engine.readBookmarks(bytes);
    expect(second).toMatchObject({ title: 'Chapter 2', page: 2, style: PLAIN });
  });

  it('moves an entry, with its children, and nests or un-nests it', async () => {
    // Chapter Two into Chapter One, after Section A.
    const nested = await edit(outlined(), [
      { kind: 'moveBookmark', path: '1', expectTitle: 'Chapter Two', parent: '0', index: 1 },
    ]);
    expect(shape(await engine.readBookmarks(nested))).toEqual([
      ['Chapter One (1)', ['Section A (2)', 'Chapter Two (4)', 'Section B (3)']],
    ]);
    expect(await linksAreConsistent(nested)).toBe(true);

    // Down one place among its own siblings: the index is read before the move.
    const reordered = await edit(outlined(), [
      { kind: 'moveBookmark', path: '0.0', expectTitle: 'Section A', parent: '0', index: 2 },
    ]);
    expect(shape(await engine.readBookmarks(reordered))[0]).toEqual([
      'Chapter One (1)',
      ['Section B (3)', 'Section A (2)'],
    ]);

    // The whole chapter after Chapter Two, taking its sections along.
    const chapter = await edit(outlined(), [
      { kind: 'moveBookmark', path: '0', expectTitle: 'Chapter One', parent: null, index: 2 },
    ]);
    expect(shape(await engine.readBookmarks(chapter))).toEqual([
      'Chapter Two (4)',
      ['Chapter One (1)', ['Section A (2)', 'Section B (3)']],
    ]);
  });

  it('refuses to move an entry inside itself, or to act on one that has moved', async () => {
    await expect(
      edit(outlined(), [
        { kind: 'moveBookmark', path: '0', expectTitle: 'Chapter One', parent: '0.1', index: 0 },
      ]),
    ).rejects.toMatchObject({ message: 'A bookmark cannot be moved inside itself.' });

    await expect(
      edit(outlined(), [{ kind: 'deleteBookmark', path: '1', expectTitle: 'Chapter One' }]),
    ).rejects.toMatchObject({ code: 'internal/unexpected' });
  });

  it('deletes an entry with what is under it, and the outline when nothing is left', async () => {
    const fewer = await edit(outlined(), [
      { kind: 'deleteBookmark', path: '0', expectTitle: 'Chapter One' },
    ]);
    expect(shape(await engine.readBookmarks(fewer))).toEqual(['Chapter Two (4)']);

    const none = await edit(fewer, [
      { kind: 'deleteBookmark', path: '0', expectTitle: 'Chapter Two' },
    ]);
    expect(await engine.readBookmarks(none)).toEqual([]);
    const document = await PDFDocument.load(none);
    expect(document.catalog.get(PDFName.of('Outlines'))).toBeUndefined();
  });

  it('starts an outline in a document that has none', async () => {
    const bytes = await edit(buildPdf({ pages: [{}, {}] }), [
      {
        kind: 'addBookmark',
        parent: null,
        index: 0,
        title: 'Start',
        target: { page: 2, top: null },
        style: PLAIN,
      },
    ]);
    expect(shape(await engine.readBookmarks(bytes))).toEqual(['Start (2)']);
  });

  it('collapses and opens an entry', async () => {
    const closed = await edit(outlined(), [
      {
        kind: 'updateBookmark',
        path: '0',
        expectTitle: 'Chapter One',
        title: null,
        style: null,
        target: null,
        open: false,
      },
    ]);
    const [first] = await engine.readBookmarks(closed);
    expect(first?.open).toBe(false);

    const document = await PDFDocument.load(closed);
    const root = document.catalog.lookup(PDFName.of('Outlines'), PDFDict);
    // Only the two top-level entries show now.
    expect((root.lookup(PDFName.of('Count')) as PDFNumber).asNumber()).toBe(2);
  });
});
