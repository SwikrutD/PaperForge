import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { PdfLibMutationEngine } from '../../../src/pdf/mutate/pdfLibEngine';
import { readPageContent } from '../../../src/pdf/content/pageContent';
import { matrixScale } from '../../../src/pdf/content/state';
import type { TextRun } from '../../../src/pdf/content/textRuns';
import { DEFAULT_TEXT_STYLE } from '../../../src/shared/schemas/text';
import { buildPdf } from '../../fixtures/pdf';

/**
 * Replacement text is drawn at the size the reader sees, which is the font
 * size scaled by the run's matrix — not the `Tf` operand alone.
 */

const engine = new PdfLibMutationEngine();

/** The size a run appears at on the page. */
function seenSize(run: TextRun | undefined): number {
  return run === undefined ? Number.NaN : run.fontSize * matrixScale(run.matrix).y;
}

async function runNamed(bytes: Uint8Array, text: string): Promise<TextRun | undefined> {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  return (await readPageContent(document, 0)).runs.find((run) => run.text === text);
}

function pageWith(content: string): Uint8Array {
  return new Uint8Array(buildPdf({ pages: [{ content }] }));
}

describe('replacement text', () => {
  it('is drawn at the size the reader chose', async () => {
    const result = await engine.apply(pageWith('BT /F1 12 Tf 60 700 Td (old) Tj ET'), [
      {
        kind: 'replaceText',
        page: 1,
        runId: 'op3',
        text: 'bigger',
        style: { ...DEFAULT_TEXT_STYLE, size: 30 },
      },
    ]);
    expect(seenSize(await runNamed(result.bytes, 'bigger'))).toBeCloseTo(30, 4);
  });

  it('keeps the size it was seen at when the matrix does the scaling', async () => {
    const original = pageWith('BT /F1 1 Tf 12 0 0 12 60 700 Tm (old) Tj ET');
    const result = await engine.apply(original, [
      { kind: 'replaceText', page: 1, runId: 'op3', text: 'same size', style: null },
    ]);

    const drawn = await runNamed(result.bytes, 'same size');
    expect(seenSize(drawn)).toBeCloseTo(12, 4);
    expect(drawn?.origin.x).toBeCloseTo(60, 4);
    expect(drawn?.origin.y).toBeCloseTo(700, 4);
  });

  it('is drawn at the size chosen when the matrix does the scaling', async () => {
    const original = pageWith('BT /F1 1 Tf 12 0 0 12 60 700 Tm (old) Tj ET');
    const result = await engine.apply(original, [
      {
        kind: 'replaceText',
        page: 1,
        runId: 'op3',
        text: 'resized',
        style: { ...DEFAULT_TEXT_STYLE, size: 20 },
      },
    ]);
    expect(seenSize(await runNamed(result.bytes, 'resized'))).toBeCloseTo(20, 4);
  });
});
