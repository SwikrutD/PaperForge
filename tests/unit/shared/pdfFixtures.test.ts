import { describe, expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { buildPdf, navigationDocument, threePageDocument } from '../../fixtures/pdf';

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

/** The shapes of the PDF.js results this file asserts on. */
interface OutlineEntry {
  title: string;
  bold?: boolean;
  items?: OutlineEntry[];
}

interface AttachmentEntry {
  filename: string;
  description?: string;
}

interface OptionalContent {
  getOrder: () => unknown[] | null;
  getGroup: (id: string) => { name: string | null } | undefined;
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

  it('produces a document with an outline, labels, an attachment and a layer', async () => {
    const document = await load(navigationDocument());

    // Page labels: roman front matter, then the body from 1.
    expect(await document.getPageLabels()).toEqual(['i', 'ii', '1', '2', '3']);

    const outline = (await document.getOutline()) as OutlineEntry[] | null;
    expect(outline?.map((item) => item.title)).toEqual(['Front matter', 'Report']);
    expect(outline?.[0]?.bold).toBe(true);
    expect(outline?.[1]?.items?.map((item) => item.title)).toEqual(['Findings', 'Appendix']);

    // PDF.js hands attachments back as a Map keyed by name.
    const attachments = (await document.getAttachments()) as Map<string, AttachmentEntry>;
    expect([...attachments.values()].map((file) => file.filename)).toEqual([
      'notes.txt',
      'installer.exe',
    ]);
    expect(attachments.get('notes.txt')?.description).toBe('Reviewer notes');

    const optionalContent = (await document.getOptionalContentConfig()) as OptionalContent;
    const order = optionalContent.getOrder() ?? [];
    expect(order).toHaveLength(1);
    const group = optionalContent.getGroup(String(order[0]));
    expect(group?.name).toBe('Watermark layer');

    // The last page carries no text, which is what search must be honest about.
    expect(await textOfPage(document, 5)).toBe('');
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
