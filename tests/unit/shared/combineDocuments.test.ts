import { describe, expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { combineDocuments, type CombinePart } from '../../../src/pdf/create/combine';
import { buildPdf } from '../../fixtures/pdf';

/**
 * Putting documents together, checked by reading the result back: the order of
 * the pages is the text on them, and the bookmarks are read the way a viewer
 * reads them, destinations resolved to real pages.
 */

const NO_METADATA = { title: '', author: '' };

function part(bytes: Uint8Array, overrides: Partial<CombinePart> = {}): CombinePart {
  return { bytes, pages: null, rotation: 0, title: 'Source', ...overrides };
}

function lettersDocument(prefix: string, count: number): Uint8Array {
  return new Uint8Array(
    buildPdf({
      pages: Array.from({ length: count }, (_, index) => ({
        text: `${prefix} ${String(index + 1)}`,
      })),
    }),
  );
}

async function pageTexts(bytes: Uint8Array): Promise<string[]> {
  const task = getDocument({ data: new Uint8Array(bytes) });
  const document = await task.promise;
  const texts: string[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const content = await (await document.getPage(pageNumber)).getTextContent();
    texts.push(
      content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join('')
        .trim(),
    );
  }
  await task.destroy();
  return texts;
}

async function rotations(bytes: Uint8Array): Promise<number[]> {
  const task = getDocument({ data: new Uint8Array(bytes) });
  const document = await task.promise;
  const found: number[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    found.push((await document.getPage(pageNumber)).rotate);
  }
  await task.destroy();
  return found;
}

interface ReadBookmark {
  title: string;
  page: number | null;
  children: ReadBookmark[];
}

/** The outline as a viewer sees it, with each entry's page resolved. */
async function bookmarks(bytes: Uint8Array): Promise<ReadBookmark[]> {
  const task = getDocument({ data: new Uint8Array(bytes) });
  const document = await task.promise;

  /** The page an entry goes to, the way a viewer resolves it. */
  const pageOf = async (destination: unknown): Promise<number | null> => {
    try {
      const resolved: unknown[] | null = Array.isArray(destination)
        ? (destination as unknown[])
        : ((await document.getDestination(String(destination))) as unknown[] | null);
      const reference: unknown = resolved?.[0] ?? null;
      if (reference === null) return null;
      return (
        (await document.getPageIndex(reference as Parameters<typeof document.getPageIndex>[0])) + 1
      );
    } catch {
      return null;
    }
  };

  const read = async (items: unknown[]): Promise<ReadBookmark[]> => {
    const result: ReadBookmark[] = [];
    for (const raw of items) {
      const item = raw as { title: string; dest: unknown; items: unknown[] };
      result.push({
        title: item.title,
        page: await pageOf(item.dest),
        children: await read(item.items),
      });
    }
    return result;
  };

  const outline = (await document.getOutline()) as unknown[] | null;
  const found = outline === null ? [] : await read(outline);
  await task.destroy();
  return found;
}

describe('combining documents', () => {
  it('keeps every page, in the order the sources were given', async () => {
    const first = lettersDocument('First', 2);
    const second = lettersDocument('Second', 3);

    const result = await combineDocuments([part(first), part(second)], {
      bookmarkPerSource: false,
      keepBookmarks: false,
      metadata: NO_METADATA,
    });

    expect(result.pageCount).toBe(5);
    expect(await pageTexts(result.bytes)).toEqual([
      'First 1',
      'First 2',
      'Second 1',
      'Second 2',
      'Second 3',
    ]);
  });

  it('takes only the pages a source was asked for, in that order', async () => {
    const source = lettersDocument('Page', 5);

    const result = await combineDocuments([part(source, { pages: [4, 1] })], {
      bookmarkPerSource: false,
      keepBookmarks: false,
      metadata: NO_METADATA,
    });

    expect(await pageTexts(result.bytes)).toEqual(['Page 4', 'Page 1']);
  });

  it('rotates the pages taken from one source without touching the others', async () => {
    const first = lettersDocument('First', 1);
    const second = lettersDocument('Second', 1);

    const result = await combineDocuments([part(first), part(second, { rotation: 90 })], {
      bookmarkPerSource: false,
      keepBookmarks: false,
      metadata: NO_METADATA,
    });

    expect(await rotations(result.bytes)).toEqual([0, 90]);
  });

  it('refuses a combine that would have no pages at all', async () => {
    const source = lettersDocument('Page', 2);
    await expect(
      combineDocuments([part(source, { pages: [9] })], {
        bookmarkPerSource: false,
        keepBookmarks: false,
        metadata: NO_METADATA,
      }),
    ).rejects.toThrow(/none of the pages/i);
  });

  it('says which file it could not read', async () => {
    const rubbish = new Uint8Array([1, 2, 3, 4]);
    await expect(
      combineDocuments([part(rubbish, { title: 'Broken.pdf' })], {
        bookmarkPerSource: false,
        keepBookmarks: false,
        metadata: NO_METADATA,
      }),
    ).rejects.toThrow(/Broken\.pdf/);
  });
});

describe('bookmarks', () => {
  const withOutline = (prefix: string): Uint8Array =>
    new Uint8Array(
      buildPdf({
        pages: [{ text: `${prefix} 1` }, { text: `${prefix} 2` }, { text: `${prefix} 3` }],
        outline: [
          { title: `${prefix} start`, page: 1 },
          { title: `${prefix} middle`, page: 2, children: [{ title: `${prefix} deep`, page: 3 }] },
        ],
      }),
    );

  it('names each source when asked to', async () => {
    const result = await combineDocuments(
      [
        part(lettersDocument('First', 2), { title: 'First file' }),
        part(lettersDocument('Second', 1), { title: 'Second file' }),
      ],
      { bookmarkPerSource: true, keepBookmarks: false, metadata: NO_METADATA },
    );

    expect(await bookmarks(result.bytes)).toEqual([
      { title: 'First file', page: 1, children: [] },
      { title: 'Second file', page: 3, children: [] },
    ]);
  });

  it("carries a source's own bookmarks onto the pages they landed on", async () => {
    const result = await combineDocuments(
      [part(lettersDocument('Front', 1)), part(withOutline('Report'), { title: 'Report' })],
      { bookmarkPerSource: false, keepBookmarks: true, metadata: NO_METADATA },
    );

    expect(await bookmarks(result.bytes)).toEqual([
      { title: 'Report start', page: 2, children: [] },
      {
        title: 'Report middle',
        page: 3,
        children: [{ title: 'Report deep', page: 4, children: [] }],
      },
    ]);
  });

  it('nests carried bookmarks under the file they came from', async () => {
    const result = await combineDocuments([part(withOutline('Report'), { title: 'Report.pdf' })], {
      bookmarkPerSource: true,
      keepBookmarks: true,
      metadata: NO_METADATA,
    });

    const outline = await bookmarks(result.bytes);
    expect(outline).toHaveLength(1);
    expect(outline[0]?.title).toBe('Report.pdf');
    expect(outline[0]?.children.map((child) => child.title)).toEqual([
      'Report start',
      'Report middle',
    ]);
  });

  it('drops a bookmark whose page was not taken, keeping the ones below it', async () => {
    // Only page 3 is taken, so "start" and "middle" point at nothing; the
    // entry nested under "middle" still points at a page that is there.
    const result = await combineDocuments([part(withOutline('Report'), { pages: [3] })], {
      bookmarkPerSource: false,
      keepBookmarks: true,
      metadata: NO_METADATA,
    });

    expect(await bookmarks(result.bytes)).toEqual([
      { title: 'Report deep', page: 1, children: [] },
    ]);
  });

  it('writes no outline at all when there is nothing to put in one', async () => {
    const result = await combineDocuments([part(lettersDocument('Plain', 1))], {
      bookmarkPerSource: false,
      keepBookmarks: true,
      metadata: NO_METADATA,
    });

    expect(await bookmarks(result.bytes)).toEqual([]);
  });
});
