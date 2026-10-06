import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { PdfLibMutationEngine } from '../../../src/pdf/mutate/pdfLibEngine';
import { readPageContent, contentBytes } from '../../../src/pdf/content/pageContent';
import { readPageWithImages } from '../../../src/pdf/mutate/images';
import { parseContent } from '../../../src/pdf/content/parser';
import { DEFAULT_TEXT_STYLE } from '../../../src/shared/schemas/text';
import type { StagedAsset } from '../../../src/pdf/mutate/types';
import type { TextRun } from '../../../src/pdf/content/textRuns';
import { buildPdf } from '../../fixtures/pdf';
import { pngPixel } from '../../fixtures/images';

/**
 * Content PaperForge appends to a page — added text, replacement text, added
 * images, headers, footers and watermarks — must start from a clean graphics
 * state. A page whose content leaves a transform, a clip, a transparency state
 * or a text setting in force at its end must not drag what is appended after
 * it somewhere else, see-through, or invisible.
 */

const engine = new PdfLibMutationEngine();

const staged = new Map<string, StagedAsset>([
  ['token', { kind: 'image', bytes: pngPixel(10, 10), format: 'png', width: 10, height: 10 }],
]);

/** A page that flips its coordinates at the top level and never undoes it. */
const FLIPPED = '1 0 0 -1 0 792 cm BT /F1 12 Tf 1 0 0 -1 50 100 Tm (flipped) Tj ET';

function pageWith(content: string): Uint8Array {
  return new Uint8Array(buildPdf({ pages: [{ content }] }));
}

async function addText(bytes: Uint8Array, text = 'added'): Promise<Uint8Array> {
  const result = await engine.apply(bytes, [
    { kind: 'addText', page: 1, x: 100, y: 200, text, style: DEFAULT_TEXT_STYLE },
  ]);
  return result.bytes;
}

async function runNamed(bytes: Uint8Array, text: string): Promise<TextRun | undefined> {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  const content = await readPageContent(document, 0);
  return content.runs.find((run) => run.text === text);
}

async function pageContent(bytes: Uint8Array): Promise<Uint8Array> {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  return contentBytes(document, document.getPage(0));
}

/** Operators whose effect outlives the text object or path they sit in. */
const LASTING = new Set(['cm', 'W', 'W*', 'gs', 'Tc', 'Tw', 'Tz', 'Ts', 'Tr']);

/**
 * What the page leaves in force just before a given operation: operators that
 * change lasting state at the outermost level, and how many `q`, `BT` and
 * marked-content sequences are still open.
 */
interface LeftBehind {
  leaked: string[];
  openSaves: number;
  inText: boolean;
  openMarked: number;
}

function stateLeftBefore(content: Uint8Array, index: number): LeftBehind {
  const operations = parseContent(content).slice(0, index);
  let depth = 0;
  let inText = false;
  let marked = 0;
  const leaked: string[] = [];
  for (const operation of operations) {
    const operator = operation.operator;
    if (operator === 'q') depth += 1;
    else if (operator === 'Q') depth -= 1;
    else if (operator === 'BT') inText = true;
    else if (operator === 'ET') inText = false;
    else if (operator === 'BDC' || operator === 'BMC') marked += 1;
    else if (operator === 'EMC') marked -= 1;
    else if (depth === 0 && LASTING.has(operator)) leaked.push(operator);
  }
  return { leaked, openSaves: depth, inText, openMarked: marked };
}

/** Index of the operation that starts the last block PaperForge appended. */
function lastAppendedBlock(content: Uint8Array, marker: (operator: string) => boolean): number {
  const operations = parseContent(content);
  // The appended block is the last top-level `q` before its marker operator.
  let found = -1;
  operations.forEach((operation, index) => {
    if (marker(operation.operator)) found = index;
  });
  for (let index = found; index >= 0; index -= 1) {
    if (operations[index]?.operator === 'q') return index;
  }
  return -1;
}

describe('added text', () => {
  it('lands where it was asked for on a page that leaves a transform in force', async () => {
    const added = await runNamed(await addText(pageWith(FLIPPED)), 'added');
    expect(added?.origin.x).toBeCloseTo(100, 4);
    expect(added?.origin.y).toBeCloseTo(200, 4);
  });

  it('lands where it was asked for after a save the page never restored', async () => {
    const unbalanced = 'q 1 0 0 1 300 0 cm BT /F1 12 Tf 50 700 Td (moved) Tj ET';
    const added = await runNamed(await addText(pageWith(unbalanced)), 'added');
    expect(added?.origin.x).toBeCloseTo(100, 4);
    expect(added?.origin.y).toBeCloseTo(200, 4);
  });

  it('is drawn visibly after an invisible text layer', async () => {
    const ocr = 'BT 3 Tr /F1 12 Tf 50 700 Td (hidden words) Tj ET';
    const added = await runNamed(await addText(pageWith(ocr)), 'added');
    expect(added?.invisible).toBe(false);
  });

  it('does not inherit the spacing, scaling and rise the page left set', async () => {
    const spaced = 'BT 4 Tc 9 Tw 50 Tz 6 Ts /F1 12 Tf 50 700 Td (spaced out) Tj ET';
    const added = await runNamed(await addText(pageWith(spaced)), 'added');
    expect(added?.charSpacing).toBe(0);
    expect(added?.wordSpacing).toBe(0);
    expect(added?.horizontalScale).toBe(100);
    expect(added?.rise).toBe(0);
  });

  it('starts from a clean state after a transparency state and a clip', async () => {
    const leaky = '/GS0 gs 0 0 100 100 re W n BT /F1 12 Tf 10 10 Td (clipped and faded) Tj ET';
    const content = await pageContent(await addText(pageWith(leaky)));
    const block = lastAppendedBlock(content, (operator) => operator === 'BT');

    expect(stateLeftBefore(content, block)).toEqual({
      leaked: [],
      openSaves: 0,
      inText: false,
      openMarked: 0,
    });
  });

  it('closes text and marked content the page left open', async () => {
    const open = '/OC /oc1 BDC BT /F1 12 Tf 50 700 Td (unfinished) Tj';
    const content = await pageContent(await addText(pageWith(open)));
    const block = lastAppendedBlock(content, (operator) => operator === 'BT');

    expect(stateLeftBefore(content, block)).toMatchObject({ inText: false, openMarked: 0 });
  });

  it('wraps a page once, however many times something is added to it', async () => {
    let bytes = pageWith(FLIPPED);
    for (const text of ['one', 'two', 'three']) bytes = await addText(bytes, text);

    const operations = parseContent(await pageContent(bytes));
    let depth = 0;
    let deepest = 0;
    for (const operation of operations) {
      if (operation.operator === 'q') deepest = Math.max(deepest, (depth += 1));
      if (operation.operator === 'Q') depth -= 1;
    }
    // The page's own drawing in one q…Q, each added block in its own.
    expect(deepest).toBe(1);
    expect((await runNamed(bytes, 'three'))?.origin.y).toBeCloseTo(200, 4);
  });

  it('leaves a page that leaves nothing behind exactly as it was', async () => {
    const clean = 'q 1 0 0 1 300 0 cm BT /F1 12 Tf 50 700 Td (tidy) Tj ET Q';
    const original = pageWith(clean);
    const before = new TextDecoder('latin1').decode(await pageContent(original));
    const after = new TextDecoder('latin1').decode(await pageContent(await addText(original)));

    expect(after.startsWith(before)).toBe(true);
  });
});

describe('replacement text', () => {
  it('is drawn where the original sat on a page that leaves a transform in force', async () => {
    // The original run sits at (50, 692) in user space once the flip applies.
    const original = pageWith(FLIPPED);
    const result = await engine.apply(original, [
      { kind: 'replaceText', page: 1, runId: 'op4', text: 'righted', style: null },
    ]);

    const drawn = await runNamed(result.bytes, 'righted');
    expect(drawn?.origin.x).toBeCloseTo(50, 4);
    expect(drawn?.origin.y).toBeCloseTo(692, 4);
  });
});

describe('added images', () => {
  it('land where they were asked for on a page that leaves a transform in force', async () => {
    const result = await engine.apply(
      pageWith(FLIPPED),
      [
        {
          kind: 'addImage',
          page: 1,
          token: 'token',
          placement: {
            x: 50,
            y: 300,
            width: 120,
            height: 60,
            rotation: 0,
            flipX: false,
            flipY: false,
          },
          opacity: 1,
        },
      ],
      staged,
    );

    const document = await PDFDocument.load(result.bytes, { updateMetadata: false });
    const image = (await readPageWithImages(document, 0)).images[0];
    expect(image?.bounds.x).toBeCloseTo(50, 4);
    expect(image?.bounds.y).toBeCloseTo(300, 4);
    expect(image?.flippedX).toBe(false);
  });
});

describe('headers, footers and watermarks', () => {
  it('start from a clean state on a page that leaves a transform in force', async () => {
    const result = await engine.apply(pageWith(FLIPPED), [
      {
        kind: 'setHeaderFooter',
        pages: [1],
        settings: {
          header: { left: '', center: 'Heading', right: '' },
          footer: { left: '', center: '', right: '' },
          style: DEFAULT_TEXT_STYLE,
          margin: 36,
          startNumber: 1,
          bates: null,
          date: '',
          title: '',
        },
      },
    ]);

    const content = await pageContent(result.bytes);
    const block = parseContent(content).findIndex((operation) => operation.operator === 'BMC');
    expect(block).toBeGreaterThan(0);
    expect(stateLeftBefore(content, block)).toMatchObject({ leaked: [], openSaves: 0 });
    // And the heading is drawn the right way up, near the top of the page.
    const heading = await runNamed(result.bytes, 'Heading');
    expect(heading?.origin.y).toBeGreaterThan(700);
  });
});
