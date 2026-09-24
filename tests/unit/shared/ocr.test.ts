import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { parseTsv } from '../../../src/main/services/tesseract/tsv';
import { PdfLibMutationEngine } from '../../../src/pdf/mutate/pdfLibEngine';
import { readPageContent } from '../../../src/pdf/content/pageContent';
import { furnitureOn } from '../../../src/pdf/content/furniture';
import { contentBytes } from '../../../src/pdf/content/pageContent';
import type { OcrWord } from '../../../src/shared/schemas/ocr';
import { buildPdf } from '../../fixtures/pdf';

/**
 * Reading a scan: what Tesseract says, and what PaperForge puts on the page
 * because of it.
 *
 * The words go on invisibly, over a picture that is left exactly as it was,
 * so the page still looks like a scan and its words can be found.
 */

const engine = new PdfLibMutationEngine();

/** A page of Tesseract's TSV, as it writes it. */
const TSV = [
  'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext',
  '1\t1\t0\t0\t0\t0\t0\t0\t2480\t3508\t-1\t',
  '2\t1\t1\t0\t0\t0\t236\t300\t1200\t60\t-1\t',
  '3\t1\t1\t1\t0\t0\t236\t300\t1200\t60\t-1\t',
  '4\t1\t1\t1\t1\t0\t236\t300\t1200\t60\t-1\t',
  '5\t1\t1\t1\t1\t1\t236\t300\t260\t48\t96.2\tInvoice',
  '5\t1\t1\t1\t1\t2\t520\t300\t180\t48\t95.1\tnumber',
  '5\t1\t1\t1\t2\t1\t236\t400\t300\t48\t12.5\tACME-0042',
  '5\t1\t1\t1\t2\t2\t560\t400\t120\t48\t-1\t ',
].join('\n');

describe("reading Tesseract's answer", () => {
  it('finds the words, their boxes and how sure it was', () => {
    const parsed = parseTsv(TSV);

    expect(parsed.words.map((word) => word.text)).toEqual(['Invoice', 'number', 'ACME-0042']);
    expect(parsed.words[0]).toEqual({
      text: 'Invoice',
      left: 236,
      top: 300,
      width: 260,
      height: 48,
      confidence: 96.2,
      line: 0,
    });
    expect(parsed.confidence).toBeCloseTo(67.9, 1);
  });

  it('keeps the lines apart, in the order they were read', () => {
    const parsed = parseTsv(TSV);

    expect(parsed.words.map((word) => word.line)).toEqual([0, 0, 1]);
    expect(parsed.text).toBe('Invoice number\nACME-0042');
  });

  it('says nothing at all about an empty page', () => {
    const parsed = parseTsv('level\tpage_num\n1\t1\t0\t0\t0\t0\t0\t0\t100\t100\t-1\t');
    expect(parsed.words).toHaveLength(0);
    expect(parsed.text).toBe('');
    expect(parsed.confidence).toBeNull();
  });
});

describe('putting the words on the page', () => {
  const words: OcrWord[] = [
    { text: 'Invoice', left: 100, top: 100, width: 300, height: 60, confidence: 96, line: 0 },
    { text: 'ACME-0042', left: 100, top: 200, width: 420, height: 60, confidence: 91, line: 1 },
  ];

  /** A page the size of a letter, as a scan of one would be at 300 DPI. */
  const page = { imageWidth: 2550, imageHeight: 3300 };

  async function recognise(): Promise<Uint8Array> {
    const original = new Uint8Array(buildPdf({ pages: [{ content: '' }] }));
    const result = await engine.apply(original, [
      {
        kind: 'addRecognisedText',
        pages: [
          {
            page: 1,
            words,
            text: 'Invoice\nACME-0042',
            imageWidth: page.imageWidth,
            imageHeight: page.imageHeight,
            confidence: 93.5,
          },
        ],
      },
    ]);
    return result.bytes;
  }

  it('can be read back as text, where the words were read from', async () => {
    const document = await PDFDocument.load(await recognise(), { updateMetadata: false });
    const content = await readPageContent(document, 0);

    expect(content.runs.map((run) => run.text)).toEqual(['Invoice', 'ACME-0042']);

    // 100 pixels of 2550 across a 612-point page is about 24 points in.
    const first = content.runs[0];
    expect(first?.origin.x).toBeCloseTo(24, 0);
    // The words sit where the scan has them, measured from the bottom.
    expect(first?.origin.y).toBeGreaterThan(740);
    expect(first?.origin.y).toBeLessThan(760);
  });

  it('draws nothing: the page still looks like the scan it is', async () => {
    const document = await PDFDocument.load(await recognise(), { updateMetadata: false });
    const content = await readPageContent(document, 0);

    expect(content.runs.every((run) => run.invisible)).toBe(true);
  });

  it('stretches each word to the marks it was read from', async () => {
    const document = await PDFDocument.load(await recognise(), { updateMetadata: false });
    const content = await readPageContent(document, 0);

    // 300 pixels of 2550 across 612 points is about 72 points wide.
    const first = content.runs[0];
    expect(first).toBeDefined();
    const width = (first?.rotation ?? 0) === 0 ? widthOfRun(first) : 0;
    expect(width).toBeGreaterThan(60);
    expect(width).toBeLessThan(85);
  });

  it('is marked as PaperForge own work, so a second reading replaces it', async () => {
    const once = await recognise();
    const document = await PDFDocument.load(once, { updateMetadata: false });
    expect(furnitureOn(contentBytes(document, document.getPage(0)))).toContain('ocr');

    const twice = await engine.apply(once, [
      {
        kind: 'addRecognisedText',
        pages: [
          {
            page: 1,
            words: [
              {
                text: 'Receipt',
                left: 100,
                top: 100,
                width: 300,
                height: 60,
                confidence: 90,
                line: 0,
              },
            ],
            text: 'Receipt',
            imageWidth: page.imageWidth,
            imageHeight: page.imageHeight,
            confidence: 90,
          },
        ],
      },
    ]);

    const after = await PDFDocument.load(twice.bytes, { updateMetadata: false });
    const content = await readPageContent(after, 0);
    expect(content.runs.map((run) => run.text)).toEqual(['Receipt']);
  });

  it('takes the words off again when the page is read and nothing is found', async () => {
    const cleared = await engine.apply(await recognise(), [
      {
        kind: 'addRecognisedText',
        pages: [
          {
            page: 1,
            words: [],
            text: '',
            imageWidth: page.imageWidth,
            imageHeight: page.imageHeight,
            confidence: null,
          },
        ],
      },
    ]);

    const document = await PDFDocument.load(cleared.bytes, { updateMetadata: false });
    expect((await readPageContent(document, 0)).runs).toHaveLength(0);
  });

  it('leaves what the page already drew exactly as it was', async () => {
    const original = new Uint8Array(buildPdf({ pages: [{ text: 'A scan of something' }] }));
    const before = new TextDecoder('latin1').decode(
      contentBytes(
        await PDFDocument.load(original, { updateMetadata: false }),
        (await PDFDocument.load(original, { updateMetadata: false })).getPage(0),
      ),
    );

    const result = await engine.apply(original, [
      {
        kind: 'addRecognisedText',
        pages: [
          {
            page: 1,
            words,
            text: 'Invoice',
            imageWidth: page.imageWidth,
            imageHeight: page.imageHeight,
            confidence: 96,
          },
        ],
      },
    ]);

    const document = await PDFDocument.load(result.bytes, { updateMetadata: false });
    const after = new TextDecoder('latin1').decode(contentBytes(document, document.getPage(0)));
    expect(after).toContain(before.trim());
  });
});

/** How wide a run is, from the glyphs it drew. */
function widthOfRun(run: { glyphs: { offset: number; advance: number }[] } | undefined): number {
  const last = run?.glyphs[run.glyphs.length - 1];
  return last === undefined ? 0 : last.offset + last.advance;
}
