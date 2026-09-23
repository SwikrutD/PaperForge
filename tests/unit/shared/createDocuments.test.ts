import { describe, expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createBlank, createFromImages, createFromText } from '../../../src/pdf/create/documents';
import { contentBox, resolveSize } from '../../../src/pdf/create/paper';
import { decodeText } from '../../../src/conversion/providers/localProviders';
import type { PageSetup } from '../../../src/shared/schemas/create';
import { pngPixel } from '../../fixtures/images';

/**
 * Making a PDF out of something that is not one.
 *
 * Everything is checked by reading the result back with PDF.js: the pages a
 * reader would see, the size they are, and the words on them.
 */

const NO_METADATA = { title: '', author: '' };
const A4: PageSetup = {
  size: { kind: 'preset', preset: 'a4', orientation: 'portrait' },
  margin: 36,
};

async function pages(bytes: Uint8Array): Promise<Array<{ width: number; height: number }>> {
  const task = getDocument({ data: new Uint8Array(bytes) });
  const document = await task.promise;
  const sizes: Array<{ width: number; height: number }> = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const viewport = (await document.getPage(pageNumber)).getViewport({ scale: 1 });
    sizes.push({ width: Math.round(viewport.width), height: Math.round(viewport.height) });
  }
  await task.destroy();
  return sizes;
}

async function textOf(bytes: Uint8Array): Promise<string[]> {
  const task = getDocument({ data: new Uint8Array(bytes) });
  const document = await task.promise;
  const texts: string[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const content = await (await document.getPage(pageNumber)).getTextContent();
    texts.push(
      content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
    );
  }
  await task.destroy();
  return texts;
}

describe('paper', () => {
  it('turns a preset and an orientation into a rectangle', () => {
    expect(resolveSize({ kind: 'preset', preset: 'letter', orientation: 'portrait' })).toEqual({
      width: 612,
      height: 792,
    });
    expect(resolveSize({ kind: 'preset', preset: 'letter', orientation: 'landscape' })).toEqual({
      width: 792,
      height: 612,
    });
  });

  it('takes a custom size as given, and says when the content decides', () => {
    expect(resolveSize({ kind: 'custom', width: 300, height: 400 })).toEqual({
      width: 300,
      height: 400,
    });
    expect(resolveSize({ kind: 'image' })).toBeNull();
  });

  it('never lets margins swallow the page', () => {
    const box = contentBox({ width: 200, height: 200 }, { ...A4, margin: 200 });
    expect(box.width).toBeGreaterThanOrEqual(24);
    expect(box.height).toBeGreaterThanOrEqual(24);
  });
});

describe('a blank document', () => {
  it('has the pages and the size it was asked for', async () => {
    const bytes = await createBlank({
      size: { width: 612, height: 792 },
      pageCount: 3,
      metadata: { title: 'Notes', author: 'A reader' },
    });

    expect(await pages(bytes)).toEqual([
      { width: 612, height: 792 },
      { width: 612, height: 792 },
      { width: 612, height: 792 },
    ]);
  });

  it('records the title and author it was given', async () => {
    const bytes = await createBlank({
      size: { width: 612, height: 792 },
      pageCount: 1,
      metadata: { title: 'Notes', author: 'A reader' },
    });

    const task = getDocument({ data: new Uint8Array(bytes) });
    const document = await task.promise;
    const { info } = (await document.getMetadata()) as unknown as {
      info: Record<string, unknown>;
    };
    expect(info['Title']).toBe('Notes');
    expect(info['Author']).toBe('A reader');
    expect(info['Producer']).toBe('PaperForge');
    await task.destroy();
  });
});

describe('images', () => {
  const image = { bytes: pngPixel(40, 20), format: 'png' as const, fileName: 'photo.png' };

  it('puts each image on a page of the chosen paper', async () => {
    const bytes = await createFromImages([image, image], A4, NO_METADATA);
    expect(await pages(bytes)).toEqual([
      { width: 595, height: 842 },
      { width: 595, height: 842 },
    ]);
  });

  it('can make the page the size of the image and its margins', async () => {
    const bytes = await createFromImages(
      [image],
      { size: { kind: 'image' }, margin: 10 },
      NO_METADATA,
    );
    expect(await pages(bytes)).toEqual([{ width: 60, height: 40 }]);
  });

  it('refuses to make a document out of nothing', async () => {
    await expect(createFromImages([], A4, NO_METADATA)).rejects.toThrow(/no images/i);
  });
});

describe('text', () => {
  it('puts the words of the file on the page', async () => {
    const bytes = await createFromText('Hello from PaperForge', A4, NO_METADATA);
    const text = await textOf(bytes);
    expect(text).toHaveLength(1);
    expect(text[0]).toContain('Hello from PaperForge');
  });

  it('runs onto as many pages as the text needs', async () => {
    const lines = Array.from({ length: 300 }, (_, index) => `Line ${String(index + 1)}`);
    const bytes = await createFromText(lines.join('\n'), A4, NO_METADATA);

    const text = await textOf(bytes);
    expect(text.length).toBeGreaterThan(1);
    expect(text[0]).toContain('Line 1');
    expect(text[text.length - 1]).toContain('Line 300');
  });

  it('makes a page even out of an empty file', async () => {
    const bytes = await createFromText('', A4, NO_METADATA);
    expect(await pages(bytes)).toHaveLength(1);
  });

  it('wraps a line too long for the page rather than cutting it', async () => {
    const long = 'PaperForge '.repeat(40).trim();
    const bytes = await createFromText(long, A4, NO_METADATA);

    const text = (await textOf(bytes)).join(' ');
    const occurrences = text.match(/PaperForge/g) ?? [];
    expect(occurrences).toHaveLength(40);
  });
});

describe('reading a text file', () => {
  it('reads UTF-8, with or without a byte order mark', () => {
    const plain = new TextEncoder().encode('Grüße');
    expect(decodeText(plain)).toBe('Grüße');
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...plain]))).toBe('Grüße');
  });

  it('reads UTF-16 when the file says so', () => {
    const utf16 = new Uint8Array([0xff, 0xfe, 0x41, 0x00, 0x42, 0x00]);
    expect(decodeText(utf16)).toBe('AB');
  });
});
