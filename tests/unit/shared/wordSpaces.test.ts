import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PdfLibMutationEngine } from '../../../src/pdf/mutate/pdfLibEngine';
import { readPageContent } from '../../../src/pdf/content/pageContent';
import { rewritability } from '../../../src/pdf/content/editText';
import type { TextRun } from '../../../src/pdf/content/textRuns';
import { runIdOf } from '../../../src/pdf/mutate/text';
import { buildPdf, type PdfSpec } from '../../fixtures/pdf';

/**
 * Many PDFs draw no space characters at all: the gap between two words is a
 * number in a `TJ` array that moves the pen along, as pdfTeX, Quartz and many
 * other generators write it. A reader sees the spaces, and PDF.js reads them,
 * so the editor must show them — and must not lose them when it writes the
 * run back.
 */

const engine = new PdfLibMutationEngine();

/** A font whose code 32 is not a space, as in TeX's encodings. */
const NO_SPACE_FONT: PdfSpec['fonts'] = [
  { name: 'F2', baseFont: 'Helvetica', differences: { 32: 'suppress' } },
];

function page(content: string, fonts?: PdfSpec['fonts']): Uint8Array {
  return new Uint8Array(buildPdf({ pages: [{ content }], ...(fonts ? { fonts } : {}) }));
}

async function firstRun(bytes: Uint8Array): Promise<TextRun> {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  const run = (await readPageContent(document, 0)).runs[0];
  if (run === undefined) throw new Error('the page drew no text');
  return run;
}

async function pdfjsText(bytes: Uint8Array): Promise<string> {
  const task = getDocument({ data: new Uint8Array(bytes) });
  const document = await task.promise;
  const content = await (await document.getPage(1)).getTextContent();
  const text = content.items.map((item) => ('str' in item ? item.str : '')).join('');
  await task.destroy();
  return text.trim();
}

async function edit(bytes: Uint8Array, text: string): Promise<Uint8Array> {
  const run = await firstRun(bytes);
  const result = await engine.apply(bytes, [
    { kind: 'editText', page: 1, runId: runIdOf(run), text },
  ]);
  return result.bytes;
}

describe('the text the editor shows for a run', () => {
  it('has a space where a TJ gap separates two words', async () => {
    const run = await firstRun(
      page('BT /F1 12 Tf 60 700 Td [(Hello)-280(brave)-280(world)] TJ ET'),
    );
    expect(run.text).toBe('Hello brave world');
  });

  it('has no space for kerning between letters', async () => {
    const run = await firstRun(page('BT /F1 12 Tf 60 700 Td [(W)80(o)-30(rld)] TJ ET'));
    expect(run.text).toBe('World');
  });

  it('keeps the spaces a run draws as characters', async () => {
    const run = await firstRun(page('BT /F1 12 Tf 60 700 Td (Hello brave world) Tj ET'));
    expect(run.text).toBe('Hello brave world');
  });
});

describe('writing a run back', () => {
  it('keeps the spaces of a run whose words are separated by TJ gaps', async () => {
    const saved = await edit(
      page('BT /F1 12 Tf 60 700 Td [(Hello)-280(brave)-280(world)] TJ ET'),
      'Hello bold world',
    );
    expect(await pdfjsText(saved)).toBe('Hello bold world');
    // Written the way the page wrote it: gaps, not space characters.
    const run = await firstRun(saved);
    expect(run.glyphs.some((glyph) => glyph.text === ' ')).toBe(false);
    expect(run.text).toBe('Hello bold world');
  });

  it('keeps space characters in a run that draws them', async () => {
    const saved = await edit(
      page('BT /F1 12 Tf 60 700 Td (Hello brave world) Tj ET'),
      'Hello bold world',
    );
    expect(await pdfjsText(saved)).toBe('Hello bold world');
    expect((await firstRun(saved)).glyphs.some((glyph) => glyph.text === ' ')).toBe(true);
  });

  it('writes spaces as gaps in a font that has no space character', async () => {
    const original = page('BT /F2 12 Tf 60 700 Td (Hello) Tj ET', NO_SPACE_FONT);
    expect(rewritability(await firstRun(original)).editable).toBe(true);

    const saved = await edit(original, 'Hello there');
    const run = await firstRun(saved);
    expect(run.text).toBe('Hello there');
    expect(run.fontName).toBe('F2');
  });

  it('keeps the line move of a quote operator it has to turn into TJ', async () => {
    const original = page("BT /F2 12 Tf 14 TL 60 700 Td (first) Tj (second) ' ET", NO_SPACE_FONT);
    const document = await PDFDocument.load(original, { updateMetadata: false });
    const second = (await readPageContent(document, 0)).runs[1];
    if (second === undefined) throw new Error('no second line');

    const result = await engine.apply(original, [
      { kind: 'editText', page: 1, runId: runIdOf(second), text: 'second line' },
    ]);
    const after = await PDFDocument.load(result.bytes, { updateMetadata: false });
    const moved = (await readPageContent(after, 0)).runs.find((run) => run.text === 'second line');
    expect(moved?.origin.y).toBeCloseTo(686, 4);
  });
});
