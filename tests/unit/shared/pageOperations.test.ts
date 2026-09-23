import { describe, expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PdfLibMutationEngine } from '../../../src/pdf/mutate/pdfLibEngine';
import type { EditOperation } from '../../../src/shared/schemas/edit';
import type { StagedAsset } from '../../../src/pdf/mutate/types';
import { buildPdf, threePageDocument } from '../../fixtures/pdf';

/**
 * The structural page operations, checked by reading the result back: the
 * order of the pages is the text on them, so a wrong move or a lost page shows
 * up as the wrong words in the wrong place.
 */
const engine = new PdfLibMutationEngine();

async function apply(
  bytes: Uint8Array,
  operations: EditOperation[],
  assets?: Map<string, StagedAsset>,
): Promise<Uint8Array> {
  const result = await engine.apply(bytes, operations, assets);
  return result.bytes;
}

/** The text of each page, in order, which is how the order is checked. */
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

async function pageSizes(bytes: Uint8Array): Promise<Array<[number, number]>> {
  const task = getDocument({ data: new Uint8Array(bytes) });
  const document = await task.promise;
  const sizes: Array<[number, number]> = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const viewport = (await document.getPage(pageNumber)).getViewport({ scale: 1 });
    sizes.push([Math.round(viewport.width), Math.round(viewport.height)]);
  }
  await task.destroy();
  return sizes;
}

/** A, B, C, D as four pages of one page each. */
function letters(): Uint8Array {
  return buildPdf({
    pages: [{ text: 'A' }, { text: 'B' }, { text: 'C' }, { text: 'D' }],
  });
}

describe('moving pages', () => {
  it('moves one page later', async () => {
    // Drop B after D: the index is counted before the move.
    const moved = await apply(letters(), [{ kind: 'movePages', pages: [2], toIndex: 4 }]);
    expect(await pageTexts(moved)).toEqual(['A', 'C', 'D', 'B']);
  });

  it('moves one page earlier', async () => {
    const moved = await apply(letters(), [{ kind: 'movePages', pages: [4], toIndex: 0 }]);
    expect(await pageTexts(moved)).toEqual(['D', 'A', 'B', 'C']);
  });

  it('keeps a block of pages in their own order', async () => {
    const moved = await apply(letters(), [{ kind: 'movePages', pages: [1, 2], toIndex: 4 }]);
    expect(await pageTexts(moved)).toEqual(['C', 'D', 'A', 'B']);
  });

  it('gathers pages that were not next to each other', async () => {
    const moved = await apply(letters(), [{ kind: 'movePages', pages: [1, 3], toIndex: 2 }]);
    expect(await pageTexts(moved)).toEqual(['B', 'A', 'C', 'D']);
  });

  it('leaves the document alone when nothing really moves', async () => {
    const moved = await apply(letters(), [{ kind: 'movePages', pages: [1], toIndex: 1 }]);
    expect(await pageTexts(moved)).toEqual(['A', 'B', 'C', 'D']);
  });
});

describe('duplicating pages', () => {
  it('puts each copy after its original', async () => {
    const copied = await apply(letters(), [{ kind: 'duplicatePages', pages: [2] }]);
    expect(await pageTexts(copied)).toEqual(['A', 'B', 'B', 'C', 'D']);
  });

  it('duplicates several pages at once', async () => {
    const copied = await apply(letters(), [{ kind: 'duplicatePages', pages: [1, 4] }]);
    expect(await pageTexts(copied)).toEqual(['A', 'A', 'B', 'C', 'D', 'D']);
  });

  // The copy has to be a page of its own: changing one must not change both.
  it('makes a copy that can be changed on its own', async () => {
    const copied = await apply(letters(), [{ kind: 'duplicatePages', pages: [1] }]);
    const rotated = await apply(copied, [{ kind: 'rotatePages', pages: [1], degrees: 90 }]);

    const task = getDocument({ data: new Uint8Array(rotated) });
    const document = await task.promise;
    expect((await document.getPage(1)).rotate).toBe(90);
    expect((await document.getPage(2)).rotate).toBe(0);
    await task.destroy();
  });
});

describe('inserting blank pages', () => {
  it('adds a page of the same size as the one before it', async () => {
    const inserted = await apply(letters(), [
      { kind: 'insertBlankPages', atIndex: 2, count: 1, size: null },
    ]);

    expect(await pageTexts(inserted)).toEqual(['A', 'B', '', 'C', 'D']);
    const sizes = await pageSizes(inserted);
    expect(sizes[2]).toEqual(sizes[1]);
  });

  it('adds several pages at a size of their own', async () => {
    const inserted = await apply(letters(), [
      { kind: 'insertBlankPages', atIndex: 0, count: 2, size: { width: 200, height: 400 } },
    ]);

    expect(await pageTexts(inserted)).toEqual(['', '', 'A', 'B', 'C', 'D']);
    expect((await pageSizes(inserted))[0]).toEqual([200, 400]);
  });
});

describe('inserting pages from another document', () => {
  const source = buildPdf({ pages: [{ text: 'X' }, { text: 'Y' }, { text: 'Z' }] });
  const assets = (): Map<string, StagedAsset> =>
    new Map([['pdf-1', { kind: 'pdf', bytes: source, pageCount: 3 }]]);

  it('takes every page when none are named', async () => {
    const inserted = await apply(
      letters(),
      [{ kind: 'insertPages', atIndex: 1, token: 'pdf-1', pages: null }],
      assets(),
    );
    expect(await pageTexts(inserted)).toEqual(['A', 'X', 'Y', 'Z', 'B', 'C', 'D']);
  });

  it('takes the pages it is asked for, in order', async () => {
    const inserted = await apply(
      letters(),
      [{ kind: 'insertPages', atIndex: 4, token: 'pdf-1', pages: [3, 1] }],
      assets(),
    );
    expect(await pageTexts(inserted)).toEqual(['A', 'B', 'C', 'D', 'X', 'Z']);
  });

  it('says so when the document it should take from is gone', async () => {
    await expect(
      apply(letters(), [{ kind: 'insertPages', atIndex: 0, token: 'pdf-9', pages: null }]),
    ).rejects.toMatchObject({ code: 'internal/unexpected' });
  });
});

describe('inserting an image as a page', () => {
  // A one-pixel PNG is enough: what matters is that it becomes a page.
  const png = Uint8Array.from(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    ),
  );
  const assets = (): Map<string, StagedAsset> =>
    new Map([['image-1', { kind: 'image', bytes: png, format: 'png', width: 1, height: 1 }]]);

  it('adds a page holding the image', async () => {
    const inserted = await apply(
      letters(),
      [
        {
          kind: 'insertImagePages',
          atIndex: 1,
          token: 'image-1',
          size: { width: 300, height: 500 },
          margin: 20,
        },
      ],
      assets(),
    );

    expect(await pageTexts(inserted)).toEqual(['A', '', 'B', 'C', 'D']);
    expect((await pageSizes(inserted))[1]).toEqual([300, 500]);
  });
});

describe('cropping', () => {
  it('sets the crop box without changing the page itself', async () => {
    const cropped = await apply(letters(), [
      {
        kind: 'cropPages',
        pages: [1],
        box: { x: 50, y: 50, width: 300, height: 400 },
        target: 'crop',
      },
    ]);

    const task = getDocument({ data: new Uint8Array(cropped) });
    const document = await task.promise;
    const page = await document.getPage(1);
    // PDF.js reports the visible box, which is the crop box.
    expect(page.view).toEqual([50, 50, 350, 450]);
    await task.destroy();
  });

  it('refuses to crop a page away entirely', async () => {
    const cropped = await apply(letters(), [
      {
        kind: 'cropPages',
        pages: [1],
        box: { x: 5000, y: 5000, width: 10, height: 10 },
        target: 'crop',
      },
    ]);

    const [size] = await pageSizes(cropped);
    expect(size?.[0]).toBeGreaterThan(0);
    expect(size?.[1]).toBeGreaterThan(0);
  });
});

describe('page labels', () => {
  it('numbers the front matter and the body separately', async () => {
    const labelled = await apply(letters(), [
      { kind: 'setPageLabels', fromPage: 1, style: 'romanLower', prefix: '', start: 1 },
      { kind: 'setPageLabels', fromPage: 3, style: 'decimal', prefix: '', start: 1 },
    ]);

    const task = getDocument({ data: new Uint8Array(labelled) });
    const document = await task.promise;
    expect(await document.getPageLabels()).toEqual(['i', 'ii', '1', '2']);
    await task.destroy();
  });

  it('keeps a prefix and a starting number', async () => {
    const labelled = await apply(letters(), [
      { kind: 'setPageLabels', fromPage: 2, style: 'decimal', prefix: 'A-', start: 5 },
    ]);

    const task = getDocument({ data: new Uint8Array(labelled) });
    const document = await task.promise;
    expect(await document.getPageLabels()).toEqual(['1', 'A-5', 'A-6', 'A-7']);
    await task.destroy();
  });
});

describe('several operations in one change', () => {
  it('applies them in order, each seeing what the last one left', async () => {
    const result = await apply(letters(), [
      { kind: 'deletePages', pages: [1] },
      { kind: 'movePages', pages: [1], toIndex: 3 },
      { kind: 'duplicatePages', pages: [3] },
    ]);

    expect(await pageTexts(result)).toEqual(['C', 'D', 'B', 'B']);
  });

  it('leaves the bytes it was given untouched', async () => {
    const source = threePageDocument();
    const before = Buffer.from(source).toString('base64');
    await apply(source, [{ kind: 'movePages', pages: [1], toIndex: 3 }]);
    expect(Buffer.from(source).toString('base64')).toBe(before);
  });
});
