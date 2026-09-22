import { describe, expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { AppError } from '../../../src/shared/errors/appError';
import { PdfLibMutationEngine } from '../../../src/pdf/mutate/pdfLibEngine';
import { buildPdf, threePageDocument } from '../../fixtures/pdf';

/**
 * The write engine, read back with the read engine.
 *
 * Both halves of the round trip are real: pdf-lib produces the bytes and
 * PDF.js parses them, which is what proves a saved document can be reopened.
 */
const engine = new PdfLibMutationEngine();

interface PageFacts {
  text: string;
  rotation: number;
}

async function readBack(bytes: Uint8Array): Promise<PageFacts[]> {
  const task = getDocument({ data: new Uint8Array(bytes), disableFontFace: true });
  const document = await task.promise;
  const pages: PageFacts[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push({
      text: content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join('')
        .trim(),
      rotation: page.rotate,
    });
  }
  await task.destroy();
  return pages;
}

describe('PdfLibMutationEngine', () => {
  it('reports what a document contains', async () => {
    const facts = await engine.inspect(threePageDocument());
    expect(facts).toEqual({ pageCount: 3, encrypted: false });
  });

  it('rotates a page and leaves the others alone', async () => {
    const result = await engine.apply(threePageDocument(), [
      { kind: 'rotatePages', pages: [2], degrees: 90 },
    ]);

    const pages = await readBack(result.bytes);
    expect(pages.map((page) => page.rotation)).toEqual([0, 90, 0]);
    expect(pages.map((page) => page.text)).toEqual([
      'PaperForge alpha page',
      'PaperForge beta page',
      'PaperForge gamma page',
    ]);
  });

  it('adds to the rotation a page already carries', async () => {
    const source = buildPdf({ pages: [{ text: 'Turned', rotate: 90 }] });
    const once = await engine.apply(source, [{ kind: 'rotatePages', pages: [1], degrees: 90 }]);
    expect((await readBack(once.bytes))[0]?.rotation).toBe(180);

    // Four quarter turns come back to where the page started.
    const twice = await engine.apply(once.bytes, [
      { kind: 'rotatePages', pages: [1], degrees: 180 },
    ]);
    expect((await readBack(twice.bytes))[0]?.rotation).toBe(0);
  });

  it('deletes pages and keeps the rest in order', async () => {
    const result = await engine.apply(threePageDocument(), [
      { kind: 'deletePages', pages: [1, 3] },
    ]);

    expect(result.pageCount).toBe(1);
    expect((await readBack(result.bytes)).map((page) => page.text)).toEqual([
      'PaperForge beta page',
    ]);
  });

  it('applies several operations in the order they were given', async () => {
    const result = await engine.apply(threePageDocument(), [
      { kind: 'deletePages', pages: [1] },
      { kind: 'rotatePages', pages: [1], degrees: 270 },
    ]);

    const pages = await readBack(result.bytes);
    expect(pages).toHaveLength(2);
    expect(pages[0]?.text).toBe('PaperForge beta page');
    expect(pages[0]?.rotation).toBe(270);
  });

  it('leaves the bytes it was given untouched', async () => {
    const source = threePageDocument();
    const before = Buffer.from(source).toString('base64');
    await engine.apply(source, [{ kind: 'deletePages', pages: [2] }]);
    expect(Buffer.from(source).toString('base64')).toBe(before);
  });

  it('reports an encrypted document rather than mangling it', async () => {
    const locked = buildPdf({ pages: [{ text: 'Secret' }], password: 'open-sesame' });

    expect(await engine.inspect(locked)).toEqual({ pageCount: 0, encrypted: true });
    await expect(
      engine.apply(locked, [{ kind: 'rotatePages', pages: [1], degrees: 90 }]),
    ).rejects.toMatchObject({ code: 'pdf/unsupported-encryption' });
  });

  it('refuses a file that is not a document at all', async () => {
    const rubbish = new TextEncoder().encode('%PDF-1.7\nnot really a document\n');
    await expect(engine.inspect(rubbish)).rejects.toBeInstanceOf(AppError);
  });
});
