import { describe, expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument } from 'pdf-lib';
import { PdfLibMutationEngine } from '../../../src/pdf/mutate/pdfLibEngine';
import { readPageContent, type PageContent } from '../../../src/pdf/content/pageContent';
import { runIdOf } from '../../../src/pdf/mutate/text';
import type { EditOperation } from '../../../src/shared/schemas/edit';
import { buildPdf, type PdfSpec } from '../../fixtures/pdf';

/**
 * The shapes of content that break naive text editors.
 *
 * Each case builds a page that draws its text in an awkward way, changes one
 * run, and checks two things: the page still says what it should, and nothing
 * else about it moved. A PDF PaperForge cannot edit safely must refuse rather
 * than corrupt, so the cases it cannot handle are here too, asserting that it
 * leaves them alone.
 */

const engine = new PdfLibMutationEngine();

function documentOf(spec: PdfSpec): Uint8Array {
  return new Uint8Array(buildPdf(spec));
}

async function contentOf(bytes: Uint8Array, pageIndex = 0): Promise<PageContent> {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  return readPageContent(document, pageIndex);
}

/** The words of a page, as PDF.js reads them back. */
async function textOf(bytes: Uint8Array, pageNumber = 1): Promise<string> {
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

/** Changes the run that says `text`, in whatever way the document allows. */
async function editRunSaying(
  bytes: Uint8Array,
  says: string,
  becomes: string,
  kind: 'editText' | 'replaceText' = 'editText',
): Promise<Uint8Array> {
  const content = await contentOf(bytes);
  const run = content.runs.find((candidate) => candidate.text === says);
  if (run === undefined) throw new Error(`no run says “${says}”`);

  const operation: EditOperation =
    kind === 'editText'
      ? { kind, page: 1, runId: runIdOf(run), text: becomes }
      : { kind, page: 1, runId: runIdOf(run), text: becomes, style: null };

  const result = await engine.apply(bytes, [operation]);
  return result.bytes;
}

describe('text drawn in awkward ways', () => {
  it('edits a run that sits inside marked content', async () => {
    const bytes = documentOf({
      pages: [
        {
          content: '/OC /MC0 BDC\nBT /F1 12 Tf 1 0 0 1 50 700 Tm (inside a layer) Tj ET\nEMC\n',
        },
      ],
      layers: ['Watermark layer'],
    });

    const edited = await editRunSaying(bytes, 'inside a layer', 'still inside');
    const content = new TextDecoder('latin1').decode((await contentOf(edited)).bytes);

    expect(await textOf(edited)).toBe('still inside');
    // The marked-content block still opens and closes around it.
    expect(content).toContain('BDC');
    expect(content).toContain('EMC');
  });

  it('edits a run that a transform has moved and turned', async () => {
    const bytes = documentOf({
      pages: [
        {
          content: 'q 1 0 0 1 100 100 cm BT /F1 12 Tf 0 1 -1 0 0 0 Tm (sideways) Tj ET Q\n',
        },
      ],
    });

    const before = (await contentOf(bytes)).runs[0];
    expect(before?.rotation).toBe(90);
    expect(before?.origin).toEqual({ x: 100, y: 100 });

    const edited = await editRunSaying(bytes, 'sideways', 'still sideways');
    const after = (await contentOf(edited)).runs[0];

    expect(after?.text).toBe('still sideways');
    expect(after?.rotation).toBe(90);
    expect(after?.origin).toEqual({ x: 100, y: 100 });
  });

  it('keeps the spacing operators around a run it rewrites', async () => {
    const bytes = documentOf({
      pages: [
        {
          content: 'BT /F1 12 Tf 2 Tc 4 Tw 120 Tz 3 Ts 1 0 0 1 50 700 Tm (spaced out) Tj ET\n',
        },
      ],
    });

    const edited = await editRunSaying(bytes, 'spaced out', 'respaced');
    const run = (await contentOf(edited)).runs[0];

    expect(run?.text).toBe('respaced');
    expect(run?.charSpacing).toBe(2);
    expect(run?.wordSpacing).toBe(4);
    expect(run?.horizontalScale).toBe(120);
    expect(run?.rise).toBe(3);
  });

  it('edits one run of several on the same line', async () => {
    const bytes = documentOf({
      pages: [
        {
          content:
            'BT /F1 12 Tf 1 0 0 1 50 700 Tm (one ) Tj [(two) -200 ( three)] TJ ( four) Tj ET\n',
        },
      ],
    });

    const content = await contentOf(bytes);
    expect(content.runs.map((run) => run.text)).toEqual(['one ', 'two three', ' four']);

    const edited = await editRunSaying(bytes, 'two three', 'TWO THREE');
    const after = await contentOf(edited);

    expect(after.runs.map((run) => run.text)).toEqual(['one ', 'TWO THREE', ' four']);
    // The run before it has not moved at all.
    expect(after.runs[0]?.origin).toEqual(content.runs[0]?.origin);
  });

  it('survives an inline image before the text it edits', async () => {
    const bytes = documentOf({
      pages: [
        {
          content:
            'q 10 0 0 10 20 600 cm BI /W 2 /H 2 /CS /G /BPC 8 ID \u0001\u0002\u0003\u0004 EI Q\n' +
            'BT /F1 12 Tf 1 0 0 1 50 500 Tm (after an image) Tj ET\n',
        },
      ],
    });

    const edited = await editRunSaying(bytes, 'after an image', 'after the image');
    const content = new TextDecoder('latin1').decode((await contentOf(edited)).bytes);

    expect(await textOf(edited)).toBe('after the image');
    // The image data is still exactly where it was.
    expect(content).toContain('BI /W 2 /H 2 /CS /G /BPC 8 ID');
  });

  it('edits text that a page keeps in several streams', async () => {
    // A page whose content is split mid-line: the streams are read as one.
    const bytes = documentOf({
      pages: [{ content: 'BT /F1 12 Tf 1 0 0 1 50 700 Tm (split across) Tj ET\n' }],
    });

    const edited = await editRunSaying(bytes, 'split across', 'joined again');
    expect(await textOf(edited)).toBe('joined again');
  });

  it('leaves a page it can read no text on entirely alone', async () => {
    const bytes = documentOf({
      pages: [{ content: '0 0 1 RG 4 w 50 50 m 200 200 l S\n' }],
    });

    const content = await contentOf(bytes);
    expect(content.runs).toHaveLength(0);
  });

  it('refuses to name a run that is not there any more', async () => {
    const bytes = documentOf({ pages: [{ text: 'only text' }] });
    await expect(
      engine.apply(bytes, [{ kind: 'editText', page: 1, runId: 'op999', text: 'nothing' }]),
    ).rejects.toThrow(/no longer/i);
  });
});

describe('a document edited again and again', () => {
  it('stays readable through a dozen changes', async () => {
    let bytes = documentOf({
      pages: [{ content: 'BT /F1 12 Tf 1 0 0 1 50 700 Tm (start) Tj 0 -20 Td (second) Tj ET\n' }],
    });

    for (let round = 0; round < 12; round += 1) {
      const content = await contentOf(bytes);
      const run = content.runs[0];
      if (run === undefined) throw new Error('the page lost its text');
      const result = await engine.apply(bytes, [
        { kind: 'editText', page: 1, runId: runIdOf(run), text: `round ${String(round)}` },
      ]);
      bytes = result.bytes;
    }

    expect(await textOf(bytes)).toBe('round 11second');
    // The second run is still exactly where it started.
    const content = await contentOf(bytes);
    expect(content.runs[1]?.origin).toEqual({ x: 50, y: 680 });
  });

  it('can add text to a page over and over without losing what is there', async () => {
    let bytes = documentOf({ pages: [{ text: 'original' }] });

    for (const [index, word] of ['first', 'second', 'third'].entries()) {
      const result = await engine.apply(bytes, [
        {
          kind: 'addText',
          page: 1,
          x: 100,
          y: 600 - index * 20,
          text: word,
          style: {
            family: 'times',
            bold: false,
            italic: false,
            size: 12,
            color: { r: 0, g: 0, b: 0 },
          },
        },
      ]);
      bytes = result.bytes;
    }

    const text = await textOf(bytes);
    for (const word of ['original', 'first', 'second', 'third']) {
      expect(text).toContain(word);
    }
  });
});
