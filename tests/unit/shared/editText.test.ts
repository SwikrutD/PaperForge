import { describe, expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PdfLibMutationEngine } from '../../../src/pdf/mutate/pdfLibEngine';
import { PDFDocument } from 'pdf-lib';
import { readPageContent, type PageContent } from '../../../src/pdf/content/pageContent';
import { rewritability } from '../../../src/pdf/content/editText';
import type { TextRun } from '../../../src/pdf/content/textRuns';
import { runIdOf } from '../../../src/pdf/mutate/text';
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
    const original = documentOf({
      pages: [{ content: 'BT /F1 12 Tf 1 0 0 1 60 700 Tm [(A) -200 (W) 120 (E)] TJ ET' }],
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
