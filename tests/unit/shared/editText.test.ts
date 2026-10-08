import { describe, expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PdfLibMutationEngine } from '../../../src/pdf/mutate/pdfLibEngine';
import { PDFDocument } from 'pdf-lib';
import { readPageContent, type PageContent } from '../../../src/pdf/content/pageContent';
import { rewritability } from '../../../src/pdf/content/editText';
import type { TextRun } from '../../../src/pdf/content/textRuns';
import { runIdOf } from '../../../src/pdf/mutate/text';
import { isReplacementFont } from '../../../src/pdf/mutate/textResources';
import { buildPdf, type PdfSpec } from '../../fixtures/pdf';

/**
 * Rewriting the text a page draws, checked the way a reader would check it:
 * open the result and see what it says.
 */

const engine = new PdfLibMutationEngine();

function documentOf(spec: PdfSpec): Uint8Array {
  return new Uint8Array(buildPdf(spec));
}

/** The text of a page, as PDF.js reads it out of the file. */
async function textOnPage(bytes: Uint8Array, pageNumber = 1): Promise<string> {
  const task = getDocument({ data: new Uint8Array(bytes) });
  const pdf = await task.promise;
  const content = await (await pdf.getPage(pageNumber)).getTextContent();
  const text = content.items
    .map((item) => ('str' in item ? item.str : ''))
    .join('')
    .trim();
  await task.destroy();
  return text;
}

interface FirstRun {
  run: TextRun;
  id: string;
  content: PageContent;
}

/** The first run of a page, and the id the renderer would name it by. */
async function firstRun(bytes: Uint8Array): Promise<FirstRun> {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  const content = await readPageContent(document, 0);
  const run = content.runs[0];
  if (run === undefined) throw new Error('the page drew no text');
  return { run, id: runIdOf(run), content };
}

async function editText(bytes: Uint8Array, runId: string, text: string): Promise<Uint8Array> {
  const result = await engine.apply(bytes, [{ kind: 'editText', page: 1, runId, text }]);
  return result.bytes;
}

describe('rewriting a run', () => {
  it('replaces what the page says', async () => {
    const original = documentOf({ pages: [{ text: 'Before the change' }] });
    const { id } = await firstRun(original);

    const edited = await editText(original, id, 'After the change');
    expect(await textOnPage(edited)).toBe('After the change');
  });

  it('leaves everything else on the page alone', async () => {
    const original = documentOf({
      pages: [
        {
          content:
            'BT /F1 12 Tf 1 0 0 1 50 700 Tm (first line) Tj 0 -20 Td (second line) Tj ET\n' +
            '0 0 1 RG 4 w 50 50 m 200 50 l S\n',
        },
      ],
    });
    const { content } = await firstRun(original);
    const before = new TextDecoder('latin1').decode(content.bytes);

    const edited = await editText(original, 'op3', 'FIRST LINE');
    const after = new TextDecoder('latin1').decode((await firstRun(edited)).content.bytes);

    expect(after).toContain('(FIRST LINE) Tj');
    expect(after).toContain('(second line) Tj');
    // The drawing after the text is untouched, character for character.
    expect(after.slice(after.indexOf('0 0 1 RG'))).toBe(before.slice(before.indexOf('0 0 1 RG')));
  });

  it('keeps the run where it was, whatever its new length', async () => {
    const original = documentOf({
      pages: [{ content: 'BT /F1 12 Tf 1 0 0 1 100 500 Tm (short) Tj ET' }],
    });

    const edited = await editText(original, 'op3', 'a much longer line of text');
    const { run } = await firstRun(edited);

    expect(run.origin).toEqual({ x: 100, y: 500 });
    expect(run.text).toBe('a much longer line of text');
  });

  it('writes a TJ array back as a single string', async () => {
    // Kerning only: no gap here is wide enough to be a space between words.
    const original = documentOf({
      pages: [{ content: 'BT /F1 12 Tf 1 0 0 1 60 700 Tm [(A) -60 (W) 120 (E)] TJ ET' }],
    });
    const { run, id } = await firstRun(original);
    expect(run.text).toBe('AWE');

    const edited = await editText(original, id, 'AWED');
    expect(await textOnPage(edited)).toBe('AWED');
    const content = new TextDecoder('latin1').decode((await firstRun(edited)).content.bytes);
    expect(content).toContain('[(AWED)] TJ');
  });

  it('escapes what would otherwise break the stream', async () => {
    const original = documentOf({ pages: [{ text: 'plain' }] });
    const { id } = await firstRun(original);

    const edited = await editText(original, id, 'a (tricky) \\ line');
    expect(await textOnPage(edited)).toBe('a (tricky) \\ line');
  });

  it('can empty a run without removing it', async () => {
    const original = documentOf({ pages: [{ text: 'goes away' }] });
    const { id } = await firstRun(original);

    const edited = await editText(original, id, '');
    expect(await textOnPage(edited)).toBe('');
  });

  it('writes the characters an encoding covers', async () => {
    const original = documentOf({ pages: [{ text: 'plain' }] });
    const { id } = await firstRun(original);

    const edited = await editText(original, id, 'Grüße “quoted”');
    expect(await textOnPage(edited)).toBe('Grüße “quoted”');
  });

  it('survives being read, edited and read again', async () => {
    let bytes = documentOf({ pages: [{ text: 'one' }] });
    for (const text of ['two', 'three', 'four']) {
      const { id } = await firstRun(bytes);
      bytes = await editText(bytes, id, text);
    }
    expect(await textOnPage(bytes)).toBe('four');
  });
});

describe('when it cannot', () => {
  it('refuses a character the font cannot write', async () => {
    const original = documentOf({ pages: [{ text: 'plain' }] });
    const { id } = await firstRun(original);

    // WinAnsi has no Cyrillic.
    await expect(editText(original, id, 'Привет')).rejects.toThrow(/cannot write/i);
  });

  it('refuses a run that is no longer there', async () => {
    const original = documentOf({ pages: [{ text: 'plain' }] });
    await expect(editText(original, 'op99', 'anything')).rejects.toThrow(/no longer/i);
  });

  it('refuses a page the document does not have', async () => {
    const original = documentOf({ pages: [{ text: 'plain' }] });
    await expect(
      engine.apply(original, [{ kind: 'editText', page: 9, runId: 'op3', text: 'x' }]),
    ).rejects.toThrow(/not in this document/i);
  });

  it('says a run cannot be edited when its font will not say what it holds', async () => {
    const bytes = documentOf({
      pages: [{ content: 'BT /F2 12 Tf 1 0 0 1 60 700 Tm <00410042> Tj ET' }],
      // A composite font with no ToUnicode says nothing about its codes.
      fonts: [{ name: 'F2', composite: true, cidWidths: { 0x41: 500, 0x42: 500 } }],
    });

    const { run } = await firstRun(bytes);
    const verdict = rewritability(run);
    expect(verdict.editable).toBe(false);
    expect(verdict.reason).toMatch(/does not say/i);
  });

  it('can rewrite a composite font that does say what it holds', async () => {
    const bytes = documentOf({
      pages: [{ content: 'BT /F2 12 Tf 1 0 0 1 60 700 Tm <00410042> Tj ET' }],
      fonts: [
        {
          name: 'F2',
          composite: true,
          toUnicode: { 0x41: 'A', 0x42: 'B' },
          cidWidths: { 0x41: 500, 0x42: 500 },
        },
      ],
    });

    const { run, id } = await firstRun(bytes);
    expect(rewritability(run).editable).toBe(true);

    const edited = await editText(bytes, id, 'BA');
    const content = new TextDecoder('latin1').decode((await firstRun(edited)).content.bytes);
    expect(content).toContain('<00420041> Tj');
  });
});

describe('rewriting a run in a subset font', () => {
  // How LibreOffice, Word and most generators write a subset: the glyphs are
  // numbered in the order the document first used them, with no /Encoding,
  // and only the ToUnicode map says which number is which letter.
  const subset = {
    name: 'F2',
    baseFont: 'BAAAAA+LiberationSans',
    widths: [610, 556, 389, 556, 889, 277],
    toUnicode: { 32: 'L', 33: 'o', 34: 'r', 35: 'e', 36: 'm', 37: ' ' },
  };
  const page = (codes: string): PdfSpec => ({
    pages: [{ content: `BT /F2 12 Tf 1 0 0 1 60 700 Tm <${codes}> Tj ET` }],
    fonts: [subset],
  });

  it('writes the glyph numbers the font uses, not ASCII', async () => {
    const original = documentOf(page('2021222324'));
    const { run, id } = await firstRun(original);
    expect(run.text).toBe('Lorem');

    const edited = await editText(original, id, 'more Lore');
    const rewritten = await firstRun(edited);
    // m o r e ␠ L o r e, each as the subset numbers it.
    const operand = rewritten.content.bytes.subarray(
      rewritten.run.textRange.start,
      rewritten.run.textRange.end,
    );
    expect(new TextDecoder('latin1').decode(operand)).toBe('($!"#% !"#)');
    expect(rewritten.run.text).toBe('more Lore');
  });

  it('writes a space with the space glyph, so words stay apart', async () => {
    const original = documentOf(page('2021222324'));
    const { id } = await firstRun(original);

    const edited = await editText(original, id, 'Lo re');
    const rewritten = await firstRun(edited);
    expect(rewritten.run.glyphs.map((glyph) => glyph.code)).toEqual([32, 33, 37, 34, 35]);
  });

  it('refuses a letter the subset has no glyph for', async () => {
    const original = documentOf(page('2021222324'));
    const { id } = await firstRun(original);
    await expect(editText(original, id, 'Lowe')).rejects.toThrow(/cannot write “w”/);
  });
});

describe('replacing text PaperForge cannot write natively', () => {
  const style = {
    family: 'helvetica' as const,
    bold: false,
    italic: false,
    size: 18,
    color: { r: 0, g: 0, b: 0 },
  };

  it('draws the new text and takes the old glyphs out', async () => {
    const original = documentOf({
      pages: [{ content: 'BT /F1 18 Tf 1 0 0 1 60 700 Tm (old words) Tj ET' }],
    });

    const result = await engine.apply(original, [
      { kind: 'replaceText', page: 1, runId: 'op3', text: 'new words', style: null },
    ]);

    expect(await textOnPage(result.bytes)).toBe('new words');
  });

  it('keeps the rest of the line where it was', async () => {
    // Two runs on one line, the second positioned by the first's advance.
    const original = documentOf({
      pages: [{ content: 'BT /F1 18 Tf 1 0 0 1 60 700 Tm (first ) Tj (second) Tj ET' }],
    });
    const before = (await firstRun(original)).content.runs[1]?.origin;

    const result = await engine.apply(original, [
      { kind: 'replaceText', page: 1, runId: 'op3', text: 'other', style: null },
    ]);
    const after = (await firstRun(result.bytes)).content.runs.find(
      (run) => run.text === 'second',
    )?.origin;

    expect(after?.x).toBeCloseTo(before?.x ?? 0, 4);
    expect(after?.y).toBeCloseTo(before?.y ?? 0, 4);
  });

  it('draws the replacement where the original sat', async () => {
    const original = documentOf({
      pages: [{ content: 'BT /F1 18 Tf 1 0 0 1 60 700 Tm (old) Tj ET' }],
    });

    const result = await engine.apply(original, [
      { kind: 'replaceText', page: 1, runId: 'op3', text: 'new', style: null },
    ]);
    const drawn = (await firstRun(result.bytes)).content.runs.find((run) => run.text === 'new');

    expect(drawn?.origin.x).toBeCloseTo(60, 4);
    expect(drawn?.origin.y).toBeCloseTo(700, 4);
    expect(drawn?.fontSize).toBeCloseTo(18, 4);
  });

  it('writes characters the original font could not', async () => {
    const original = documentOf({ pages: [{ text: 'plain' }] });

    // Latin-1 characters a standard font can draw, in a run that keeps them.
    const result = await engine.apply(original, [
      { kind: 'replaceText', page: 1, runId: 'op3', text: 'Grüße', style: null },
    ]);
    expect(await textOnPage(result.bytes)).toBe('Grüße');
  });

  it('marks what it drew as its own', async () => {
    const original = documentOf({ pages: [{ text: 'plain' }] });
    const result = await engine.apply(original, [
      { kind: 'replaceText', page: 1, runId: 'op3', text: 'replaced', style: null },
    ]);

    const drawn = (await firstRun(result.bytes)).content.runs.find(
      (run) => run.text === 'replaced',
    );
    expect(isReplacementFont(drawn?.fontName ?? null)).toBe(true);
  });

  it('takes the style the reader chose', async () => {
    const original = documentOf({ pages: [{ text: 'plain' }] });
    const result = await engine.apply(original, [
      {
        kind: 'replaceText',
        page: 1,
        runId: 'op3',
        text: 'styled',
        style: { ...style, family: 'times', bold: true, size: 30, color: { r: 1, g: 0, b: 0 } },
      },
    ]);

    const drawn = (await firstRun(result.bytes)).content.runs.find((run) => run.text === 'styled');
    expect(drawn?.fontSize).toBeCloseTo(30, 4);
    expect(drawn?.font?.baseFont).toContain('Times');
    expect(drawn?.color.components).toEqual([1, 0, 0]);
  });

  it('keeps the invisible text of a recognised scan invisible', async () => {
    // An OCR layer: words drawn in render mode 3, over a picture of the page.
    const original = documentOf({
      pages: [{ content: 'BT 3 Tr /F1 12 Tf 60 700 Td (recognised) Tj ET' }],
    });
    const result = await engine.apply(original, [
      { kind: 'replaceText', page: 1, runId: 'op4', text: 'corrected', style: null },
    ]);

    const drawn = (await firstRun(result.bytes)).content.runs.find(
      (run) => run.text === 'corrected',
    );
    expect(drawn?.invisible).toBe(true);
    expect(await textOnPage(result.bytes)).toContain('corrected');
  });

  it('draws a question mark for what no standard font can write', async () => {
    const original = documentOf({ pages: [{ text: 'plain' }] });
    const result = await engine.apply(original, [
      { kind: 'replaceText', page: 1, runId: 'op3', text: 'Привет', style: null },
    ]);

    // Honest rather than silent: the text is there, the glyphs are not.
    expect(await textOnPage(result.bytes)).toBe('??????');
  });
});

describe('adding text', () => {
  it('draws new text where it was asked for', async () => {
    const original = documentOf({ pages: [{ text: 'existing' }] });

    const result = await engine.apply(original, [
      {
        kind: 'addText',
        page: 1,
        x: 100,
        y: 200,
        text: 'added later',
        style: {
          family: 'helvetica',
          bold: false,
          italic: false,
          size: 14,
          color: { r: 0, g: 0, b: 1 },
        },
      },
    ]);

    const added = (await firstRun(result.bytes)).content.runs.find(
      (run) => run.text === 'added later',
    );
    expect(added?.origin).toEqual({ x: 100, y: 200 });
    expect(added?.fontSize).toBe(14);
    expect(added?.color.components).toEqual([0, 0, 1]);
    // What was already there is still there.
    expect(await textOnPage(result.bytes)).toContain('existing');
  });

  it('reuses one font resource however many times it is asked for', async () => {
    let bytes = documentOf({ pages: [{ text: 'existing' }] });
    for (const text of ['one', 'two', 'three']) {
      const result = await engine.apply(bytes, [
        {
          kind: 'addText',
          page: 1,
          x: 100,
          y: 200,
          text,
          style: {
            family: 'helvetica',
            bold: false,
            italic: false,
            size: 12,
            color: { r: 0, g: 0, b: 0 },
          },
        },
      ]);
      bytes = result.bytes;
    }

    const { content } = await firstRun(bytes);
    const names = new Set([...content.fonts.keys()].filter((name) => name.startsWith('PF')));
    expect(names.size).toBe(1);
  });
});
