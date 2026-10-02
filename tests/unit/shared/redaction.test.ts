import { describe, expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFStream,
  PDFString,
  decodePDFRawStream,
  type PDFObject,
} from 'pdf-lib';
import { PdfLibMutationEngine } from '../../../src/pdf/mutate/pdfLibEngine';
import { readPageContent } from '../../../src/pdf/content/pageContent';
import type { StagedAsset } from '../../../src/pdf/mutate/types';
import {
  DEFAULT_REDACTION_APPEARANCE,
  type RedactionAppearance,
  type RedactionMark,
  type RedactionRect,
} from '../../../src/shared/schemas/redaction';
import { buildPdf, type PdfSpec } from '../../fixtures/pdf';
import { pngPixel } from '../../fixtures/images';
import { buildFormPdf } from '../../fixtures/forms';

/**
 * The redaction gate (CLAUDE.md segment 15): after redactions are applied, the
 * marked text must not come back out of the file — not through PDF.js text
 * extraction, and not from anywhere in its bytes, decompressed or not.
 */

const engine = new PdfLibMutationEngine();

function documentOf(spec: PdfSpec): Uint8Array {
  return new Uint8Array(buildPdf(spec));
}

/** What PDF.js reads off a page, as a search would see it. */
async function textOf(bytes: Uint8Array, pageNumber = 1): Promise<string> {
  const task = getDocument({ data: new Uint8Array(bytes) });
  const pdf = await task.promise;
  const content = await (await pdf.getPage(pageNumber)).getTextContent();
  const text = content.items.map((item) => ('str' in item ? item.str : '')).join('');
  await task.destroy();
  return text;
}

/**
 * Every byte of the file, and every object in it — including those packed
 * into compressed object streams — with each stream decompressed and each
 * string decoded alongside.
 */
async function everythingIn(bytes: Uint8Array): Promise<string> {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  const parts = [Buffer.from(bytes).toString('latin1')];
  const collect = (object: PDFObject): void => {
    if (object instanceof PDFString || object instanceof PDFHexString) {
      parts.push(object.decodeText());
    } else if (object instanceof PDFStream) {
      collect(object.dict);
      try {
        const decoded =
          object instanceof PDFRawStream
            ? decodePDFRawStream(object).decode()
            : object.getContents();
        parts.push(Buffer.from(decoded).toString('latin1'));
      } catch {
        // A stream pdf-lib cannot decode is still in the raw bytes above.
      }
    } else if (object instanceof PDFDict) {
      for (const [, value] of object.entries()) collect(value);
    } else if (object instanceof PDFArray) {
      for (const value of object.asArray()) collect(value);
    }
  };
  for (const [, object] of document.context.enumerateIndirectObjects()) collect(object);
  return parts.join('\n');
}

async function marksFor(
  bytes: Uint8Array,
  query: string,
  options: { matchCase?: boolean; wholeWord?: boolean } = {},
): Promise<RedactionMark[]> {
  const result = await engine.findForRedaction(bytes, {
    query,
    matchCase: options.matchCase ?? false,
    wholeWord: options.wholeWord ?? false,
  });
  return result.matches.map((match, index) => ({
    id: `m${String(index)}`,
    page: match.page,
    rects: match.rects,
    reason: null,
  }));
}

function area(page: number, rect: RedactionRect, reason: string | null = null): RedactionMark {
  return { id: `area-${String(rect.x)}-${String(rect.y)}`, page, rects: [rect], reason };
}

async function redact(
  bytes: Uint8Array,
  marks: readonly RedactionMark[],
  options: {
    appearance?: RedactionAppearance;
    rasterPages?: Array<{ page: number; token: string; viewBox: [number, number, number, number] }>;
    assets?: ReadonlyMap<string, StagedAsset>;
  } = {},
): Promise<Uint8Array> {
  const result = await engine.apply(
    bytes,
    [
      {
        kind: 'applyRedactions',
        marks: marks.map(({ page, rects, reason }) => ({ page, rects, reason })),
        appearance: options.appearance ?? DEFAULT_REDACTION_APPEARANCE,
        rasterPages: options.rasterPages ?? [],
      },
    ],
    options.assets,
  );
  return result.bytes;
}

async function imagesIn(bytes: Uint8Array): Promise<PDFStream[]> {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  return document.context
    .enumerateIndirectObjects()
    .map(([, object]) => object)
    .filter(
      (object): object is PDFStream =>
        object instanceof PDFStream &&
        object.dict.lookup(PDFName.of('Subtype'))?.toString() === '/Image',
    );
}

const LINE =
  'BT /F1 12 Tf 1 0 0 1 72 700 Tm (Account holder: ) Tj (TOP SECRET PHRASE) Tj ( is on file) Tj ET\n';

describe('finding text to mark', () => {
  it('marks a phrase drawn across several runs as one bar per line', async () => {
    const bytes = documentOf({ pages: [{ content: LINE }] });
    const result = await engine.findForRedaction(bytes, {
      query: 'secret phrase',
      matchCase: false,
      wholeWord: true,
    });

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.text).toBe('SECRET PHRASE');
    expect(result.matches[0]?.rects).toHaveLength(1);
  });

  it('honours case and whole words', async () => {
    const bytes = documentOf({ pages: [{ content: LINE }] });
    expect(await marksFor(bytes, 'secret', { matchCase: true })).toHaveLength(0);
    expect(await marksFor(bytes, 'SECR', { wholeWord: true })).toHaveLength(0);
    expect(await marksFor(bytes, 'SECR')).toHaveLength(1);
  });

  it('reads words spaced by positioning rather than by a space', async () => {
    const bytes = documentOf({
      pages: [{ content: 'BT /F1 12 Tf 72 700 Td [(Card)-300(number)-300(4111)] TJ ET\n' }],
    });
    expect(await marksFor(bytes, 'number 4111')).toHaveLength(1);
  });

  it('says which pages have no text to search', async () => {
    const bytes = documentOf({
      pages: [{ content: LINE }, { content: '0 0 1 rg 10 10 5 5 re f\n' }],
    });
    const result = await engine.findForRedaction(bytes, {
      query: 'anything',
      matchCase: false,
      wholeWord: false,
    });
    expect(result.textlessPages).toEqual([2]);
  });
});

describe('applying redactions removes the text for good', () => {
  it('takes the phrase out and leaves the rest of the line where it was', async () => {
    const bytes = documentOf({ pages: [{ content: LINE }] });
    const before = await readPageContent(await PDFDocument.load(bytes), 0);
    const tail = before.runs.find((run) => run.text === ' is on file');

    const redacted = await redact(bytes, await marksFor(bytes, 'TOP SECRET PHRASE'));

    const text = await textOf(redacted);
    expect(text).not.toContain('SECRET');
    expect(text).toContain('Account holder:');
    expect(text).toContain('is on file');
    expect(await everythingIn(redacted)).not.toContain('SECRET');

    const after = await readPageContent(await PDFDocument.load(redacted), 0);
    const moved = after.runs.find((run) => run.text === ' is on file');
    expect(moved?.origin.x).toBeCloseTo(tail?.origin.x ?? 0, 3);
  });

  it('cuts glyphs out of the middle of a single run', async () => {
    const bytes = documentOf({
      pages: [{ content: 'BT /F1 12 Tf 72 700 Td (Name: Jane Roe, born 1970) Tj ET\n' }],
    });
    const redacted = await redact(bytes, await marksFor(bytes, 'Jane Roe'));

    const text = await textOf(redacted);
    expect(text).not.toMatch(/Jane|Roe/);
    expect(text).toContain('Name:');
    expect(text).toContain('born 1970');
    expect(await everythingIn(redacted)).not.toMatch(/Jane|Roe/);
  });

  it('handles kerned arrays and the quote operators', async () => {
    const bytes = documentOf({
      pages: [
        {
          content:
            'BT /F1 12 Tf 14 TL 72 700 Td [(Con)20(fiden)-10(tial)-250(data)] TJ ' +
            '(Second line Classified) \' 2 1 (Third line Restricted) " ET\n',
        },
      ],
    });
    let redacted = bytes;
    for (const word of ['Confidential', 'Classified', 'Restricted']) {
      redacted = await redact(redacted, await marksFor(redacted, word));
    }

    const text = await textOf(redacted);
    expect(text).not.toMatch(/Confidential|Classified|Restricted/);
    expect(text).toContain('data');
    expect(text).toContain('Second line');
    expect(text).toContain('Third line');
  });

  it('removes text from a two-byte composite font', async () => {
    const bytes = documentOf({
      pages: [{ content: 'BT /F2 12 Tf 72 700 Td <000100020003000400050006> Tj ET\n' }],
      fonts: [
        {
          name: 'F2',
          composite: true,
          toUnicode: { 1: 'K', 2: 'E', 3: 'Y', 4: ' ', 5: 'O', 6: 'K' },
          cidWidths: { 1: 600, 2: 600, 3: 600, 4: 300, 5: 600, 6: 600 },
        },
      ],
    });
    const redacted = await redact(bytes, await marksFor(bytes, 'KEY', { wholeWord: true }));

    const text = await textOf(redacted);
    expect(text).not.toContain('KEY');
    expect(text).toContain('OK');
  });

  it('removes invisible text, such as a recognised-text layer', async () => {
    const bytes = documentOf({
      pages: [{ content: 'BT 3 Tr /F1 12 Tf 72 700 Td (hidden account 12345) Tj ET\n' }],
    });
    const redacted = await redact(bytes, await marksFor(bytes, '12345'));
    expect(await textOf(redacted)).not.toContain('12345');
    expect(await everythingIn(redacted)).not.toContain('12345');
  });

  it('drops replacement text that would say what the glyphs said', async () => {
    const bytes = documentOf({
      pages: [
        {
          content:
            '/Span << /ActualText (PASSWORD) /Lang (en) >> BDC\n' +
            'BT /F1 12 Tf 72 700 Td (xxxxxxxx) Tj ET\nEMC\n',
        },
      ],
    });
    const redacted = await redact(bytes, await marksFor(bytes, 'xxxxxxxx'));
    expect(await everythingIn(redacted)).not.toContain('PASSWORD');
    expect(await textOf(redacted)).not.toContain('PASSWORD');
  });

  it('removes earlier content streams, not only the reference to them', async () => {
    const bytes = documentOf({ pages: [{ content: LINE }] });
    // An earlier edit leaves the original stream behind in pdf-lib's object
    // table; redaction must not let it travel on.
    const edited = (await engine.apply(bytes, [{ kind: 'rotatePages', pages: [1], degrees: 90 }]))
      .bytes;
    const redacted = await redact(edited, await marksFor(edited, 'SECRET'));
    expect(await everythingIn(redacted)).not.toContain('SECRET');
  });

  it('paints a box over each area, with the reason when asked', async () => {
    const bytes = documentOf({ pages: [{ content: LINE }] });
    const marks = (await marksFor(bytes, 'SECRET PHRASE')).map((mark) => ({
      ...mark,
      reason: 'Personal data',
    }));
    const redacted = await redact(bytes, marks, {
      appearance: { fill: { r: 0, g: 0, b: 0 }, showReason: true },
    });

    const content = Buffer.from(
      (await readPageContent(await PDFDocument.load(redacted), 0)).bytes,
    ).toString('latin1');
    expect(content).toContain('/PFRedaction BMC');
    expect(content).toMatch(/re f/);
    // The reason is overlay text: it is meant to be read.
    expect(await textOf(redacted)).toContain('Personal');
  });
});

describe('pictures, drawings and groups under a mark', () => {
  it('removes a picture wholly under a mark, and its data with it', async () => {
    const bytes = documentOf({
      pages: [{ content: LINE, image: { x: 100, y: 100, width: 50, height: 50 } }],
    });
    expect(await imagesIn(bytes)).toHaveLength(1);

    const redacted = await redact(bytes, [area(1, { x: 90, y: 90, width: 70, height: 70 })]);
    expect(await imagesIn(redacted)).toHaveLength(0);
    expect(await textOf(redacted)).toContain('SECRET');
  });

  it('repaints the covered part of a picture and keeps the rest', async () => {
    const bytes = documentOf({
      pages: [
        {
          content: '',
          image: { x: 100, y: 100, width: 100, height: 100, pixels: { width: 10, height: 10 } },
        },
      ],
    });
    // The left half of the picture.
    const redacted = await redact(bytes, [area(1, { x: 90, y: 90, width: 60, height: 120 })]);

    const images = await imagesIn(redacted);
    expect(images).toHaveLength(1);
    const samples = decodePDFRawStream(images[0] as PDFRawStream).decode();
    const pixel = (column: number, row: number): number[] => {
      const offset = (row * 10 + column) * 3;
      return [...samples.subarray(offset, offset + 3)];
    };
    expect(pixel(0, 5)).toEqual([0, 0, 0]);
    expect(pixel(4, 0)).toEqual([0, 0, 0]);
    expect(pixel(5, 5)).toEqual([200, 40, 40]);
    expect(pixel(9, 9)).toEqual([200, 40, 40]);
  });

  it('removes a drawing wholly under a mark and leaves one crossing its edge', async () => {
    const bytes = documentOf({
      pages: [{ content: '0 0 1 rg 100 300 20 20 re f\n0 1 0 rg 130 300 100 20 re f\n' }],
    });
    const redacted = await redact(bytes, [area(1, { x: 90, y: 290, width: 60, height: 40 })]);
    const content = Buffer.from(
      (await readPageContent(await PDFDocument.load(redacted), 0)).bytes,
    ).toString('latin1');
    expect(content).not.toContain('100 300 20 20 re');
    expect(content).toContain('130 300 100 20 re');
  });

  it('removes a group wholly under a mark, text and all', async () => {
    const bytes = documentOf({
      pages: [
        {
          content: 'q 1 0 0 1 72 600 cm /Fm0 Do Q\n',
          form: {
            content: 'BT /F1 12 Tf 0 10 Td (inside the group) Tj ET\n',
            bbox: [0, 0, 200, 40],
          },
        },
      ],
    });
    const redacted = await redact(bytes, [area(1, { x: 60, y: 590, width: 230, height: 60 })]);
    expect(await everythingIn(redacted)).not.toContain('inside the group');
  });

  it('removes a picture from the file even when another page lists it unused', async () => {
    const document = await PDFDocument.create();
    const image = await document.embedPng(pngPixel(4, 4));
    const first = document.addPage([300, 300]);
    first.drawImage(image, { x: 50, y: 50, width: 100, height: 100 });
    const second = document.addPage([300, 300]);
    // One resources dictionary for both pages, as many generators write it.
    const shared = document.context.register(
      document.context.lookup(first.node.get(PDFName.of('Resources'))) as never,
    );
    first.node.set(PDFName.of('Resources'), shared);
    second.node.set(PDFName.of('Resources'), shared);
    const bytes = await document.save();
    expect(await imagesIn(bytes)).toHaveLength(1);

    const redacted = await redact(bytes, [area(1, { x: 40, y: 40, width: 120, height: 120 })]);
    expect(await imagesIn(redacted)).toHaveLength(0);
  });
});

describe('what cannot be cut is drawn as a picture, never half-done', () => {
  const groupPage: PdfSpec = {
    pages: [
      {
        content:
          'q 1 0 0 1 72 600 cm /Fm0 Do Q\nBT /F1 12 Tf 72 700 Td (outside the group) Tj ET\n',
        form: { content: 'BT /F1 12 Tf 0 10 Td (inside the group) Tj ET\n', bbox: [0, 0, 200, 40] },
      },
    ],
  };
  const partOfGroup = area(1, { x: 72, y: 600, width: 40, height: 40 });

  it('says why a page must become a picture', async () => {
    const plan = await engine.planRedactions(documentOf(groupPage), [partOfGroup]);
    expect(plan.pages).toEqual([
      { page: 1, mode: 'raster', reasons: [expect.stringMatching(/reusable group/)] },
    ]);
  });

  it('refuses to apply natively rather than leaving content under the mark', async () => {
    await expect(redact(documentOf(groupPage), [partOfGroup])).rejects.toMatchObject({
      code: 'redact/failed',
    });
  });

  it('replaces the page with the picture it is given, and nothing of the old page stays', async () => {
    const assets = new Map<string, StagedAsset>([
      ['raster', { kind: 'image', format: 'png', bytes: pngPixel(20, 26), width: 20, height: 26 }],
    ]);
    const redacted = await redact(documentOf(groupPage), [partOfGroup], {
      rasterPages: [{ page: 1, token: 'raster', viewBox: [0, 0, 612, 792] }],
      assets,
    });

    expect(await textOf(redacted)).toBe('');
    const everything = await everythingIn(redacted);
    expect(everything).not.toContain('inside the group');
    expect(everything).not.toContain('outside the group');
  });

  it('treats text in a font it cannot measure as needing a picture', async () => {
    const bytes = documentOf({
      pages: [{ content: 'BT /F2 12 Tf 72 700 Td (mystery text) Tj ET\n' }],
      fonts: [{ name: 'F2', baseFont: 'MysteryFont' }],
    });
    const plan = await engine.planRedactions(bytes, [
      area(1, { x: 70, y: 695, width: 40, height: 15 }),
    ]);
    expect(plan.pages[0]?.mode).toBe('raster');
  });
});

describe('comments and fields under a mark', () => {
  it('removes an annotation under a mark and keeps one elsewhere', async () => {
    const bytes = documentOf({
      pages: [
        {
          content: LINE,
          annotations: [
            '<< /Type /Annot /Subtype /FreeText /Rect [100 500 200 520] /Contents (Secret note) /DA (/Helv 12 Tf 0 g) >>',
            '<< /Type /Annot /Subtype /Text /Rect [400 400 420 420] /Contents (Keep me) >>',
          ],
        },
      ],
    });
    const redacted = await redact(bytes, [area(1, { x: 95, y: 495, width: 110, height: 30 })]);

    const everything = await everythingIn(redacted);
    expect(everything).not.toContain('Secret note');
    expect(everything).toContain('Keep me');
  });

  it('removes a form field under a mark, value and all, and keeps the rest of the form', async () => {
    const bytes = await buildFormPdf();
    // The name field is drawn at 40,320 and holds "Ada".
    const redacted = await redact(bytes, [area(1, { x: 30, y: 310, width: 60, height: 40 })]);

    const form = (await PDFDocument.load(redacted)).getForm();
    expect(form.getFieldMaybe('person.name')).toBeUndefined();
    expect(form.getFieldMaybe('person.notes')).toBeDefined();
    expect(await everythingIn(redacted)).not.toContain('Ada');
  });

  it('takes a pop-up with the note it belongs to', async () => {
    const bytes = documentOf({
      pages: [
        {
          content: LINE,
          annotations: [
            '<< /Type /Annot /Subtype /Text /Rect [100 500 120 520] /Contents (Private remark) /Popup 6 0 R >>',
            '<< /Type /Annot /Subtype /Popup /Rect [300 300 450 400] /Parent 5 0 R >>',
          ],
        },
      ],
    });
    const redacted = await redact(bytes, [area(1, { x: 95, y: 495, width: 30, height: 30 })]);
    const annotations = (await PDFDocument.load(redacted))
      .getPage(0)
      .node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    expect(annotations?.size() ?? 0).toBe(0);
    expect(await everythingIn(redacted)).not.toContain('Private remark');
  });

  it('reports what each mark will take before anything is applied', async () => {
    const bytes = documentOf({ pages: [{ content: LINE }] });
    const [mark] = await marksFor(bytes, 'SECRET PHRASE');
    const plan = await engine.planRedactions(bytes, [mark as RedactionMark]);

    expect(plan.pages).toEqual([{ page: 1, mode: 'native', reasons: [] }]);
    expect(plan.marks[0]?.text).toBe('SECRET PHRASE');
  });
});
