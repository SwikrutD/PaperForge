import { describe, expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { buildPdf, threePageDocument } from '../../fixtures/pdf';

/**
 * Reads the generated fixtures with PDF.js itself, in Node.
 *
 * This is the closest thing to an integration test the viewer can have without
 * a browser: it proves the documents the other tests rely on are real PDFs, and
 * that PDF.js reports the page count, sizes, rotation, text and encryption the
 * viewer builds its behaviour on.
 */
type LoadedFixture = Awaited<ReturnType<typeof getDocument>['promise']> & {
  close: () => Promise<void>;
};

async function load(bytes: Buffer, password?: string): Promise<LoadedFixture> {
  const task = getDocument({
    data: new Uint8Array(bytes),
    ...(password === undefined ? {} : { password }),
    disableFontFace: true,
    useSystemFonts: false,
  });
  const document = await task.promise;
  // The loading task owns the worker; the document proxy has no destroy().
  return Object.assign(document, { close: () => task.destroy() });
}

async function textOfPage(document: LoadedFixture, pageNumber: number): Promise<string> {
  const page = await document.getPage(pageNumber);
  const content = await page.getTextContent();
  return content.items
    .map((item) => ('str' in item ? item.str : ''))
    .join('')
    .trim();
}

describe('generated PDF fixtures', () => {
  it('produces a single-page document', async () => {
    const document = await load(buildPdf({ pages: [{ text: 'Only page' }] }));

    expect(document.numPages).toBe(1);
    expect(await textOfPage(document, 1)).toBe('Only page');
    await document.close();
  });

  it('produces a multi-page document with text on each page', async () => {
    const document = await load(threePageDocument());

    expect(document.numPages).toBe(3);
    expect(await textOfPage(document, 1)).toBe('PaperForge alpha page');
    expect(await textOfPage(document, 3)).toBe('PaperForge gamma page');
    await document.close();
  });

  it('keeps the rotation stored on a page', async () => {
    const document = await load(
      buildPdf({ pages: [{ text: 'Upright' }, { text: 'Turned', rotate: 90 }] }),
    );

    const first = await document.getPage(1);
    const second = await document.getPage(2);
    expect(first.rotate).toBe(0);
    expect(second.rotate).toBe(90);

    // A quarter turn swaps the viewport's sides, which is what the layout uses.
    const upright = first.getViewport({ scale: 1 });
    const turned = second.getViewport({ scale: 1 });
    expect(upright.width).toBeCloseTo(612, 1);
    expect(turned.width).toBeCloseTo(792, 1);
    expect(turned.height).toBeCloseTo(612, 1);
    await document.close();
  });

  it('produces unusual page sizes in one document', async () => {
    const document = await load(
      buildPdf({
        pages: [
          { text: 'Tiny', width: 72, height: 72 },
          { text: 'Wide', width: 1684, height: 1190 },
          { text: 'Tall', width: 200, height: 2000 },
        ],
      }),
    );

    const sizes = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const viewport = (await document.getPage(pageNumber)).getViewport({ scale: 1 });
      sizes.push([Math.round(viewport.width), Math.round(viewport.height)]);
    }

    expect(sizes).toEqual([
      [72, 72],
      [1684, 1190],
      [200, 2000],
    ]);
    await document.close();
  });

  it('produces an encrypted document that needs its password', async () => {
    const bytes = buildPdf({ pages: [{ text: 'Secret contents' }], password: 'open-sesame' });

    await expect(load(bytes)).rejects.toMatchObject({ name: 'PasswordException' });
    await expect(load(bytes, 'wrong')).rejects.toMatchObject({ name: 'PasswordException' });

    const document = await load(bytes, 'open-sesame');
    expect(document.numPages).toBe(1);
    expect(await textOfPage(document, 1)).toBe('Secret contents');
    await document.close();
  });
});
