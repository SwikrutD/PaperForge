import { describe, expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PdfLibMutationEngine } from '../../../src/pdf/mutate/pdfLibEngine';
import { encodeWinAnsi, isDrawable } from '../../../src/pdf/text/layout';
import { DEFAULT_TEXT_STYLE } from '../../../src/shared/schemas/text';
import { buildPdf } from '../../fixtures/pdf';

/**
 * The standard fonts PaperForge draws replacement and added text with are
 * written in WinAnsi (Windows code page 1252). That covers Latin-1 and also
 * the punctuation word processors use everywhere: curly quotes, dashes, the
 * ellipsis, the euro sign and bullets. Those must be drawn as themselves, not
 * flattened to straight quotes and hyphens, nor refused.
 */

const engine = new PdfLibMutationEngine();

/** Everything in 0x80–0x9F that people actually type, plus Latin-1. */
const PUNCTUATION = 'It’s ‘quoted’ – “really” — done… €5 • Grüße ™';

async function textOnPage(bytes: Uint8Array): Promise<string> {
  const task = getDocument({ data: new Uint8Array(bytes) });
  const pdf = await task.promise;
  const content = await (await pdf.getPage(1)).getTextContent();
  const text = content.items.map((item) => ('str' in item ? item.str : '')).join('');
  await task.destroy();
  return text;
}

function page(): Uint8Array {
  return new Uint8Array(buildPdf({ pages: [{ content: 'BT /F1 18 Tf 60 700 Td (old) Tj ET' }] }));
}

describe('what the standard fonts can draw', () => {
  it('includes the WinAnsi punctuation word processors use', () => {
    expect(isDrawable(PUNCTUATION)).toBe(true);
  });

  it('excludes writing systems WinAnsi does not cover', () => {
    expect(isDrawable('Привет')).toBe(false);
    expect(isDrawable('日本')).toBe(false);
  });

  it('encodes punctuation to its WinAnsi codes and names what it cannot', () => {
    const encoded = encodeWinAnsi('’–€ Ж');
    expect([...encoded.bytes]).toEqual([0x92, 0x96, 0x80, 0x20, 0x3f]);
    expect(encoded.undrawable).toEqual(['Ж']);
  });
});

describe('replacement text', () => {
  it('draws WinAnsi punctuation as itself', async () => {
    const result = await engine.apply(page(), [
      { kind: 'replaceText', page: 1, runId: 'op3', text: PUNCTUATION, style: null },
    ]);
    expect((await textOnPage(result.bytes)).trim()).toBe(PUNCTUATION);
  });
});

describe('added text', () => {
  it('draws WinAnsi punctuation as itself', async () => {
    const result = await engine.apply(page(), [
      { kind: 'addText', page: 1, x: 60, y: 400, text: PUNCTUATION, style: DEFAULT_TEXT_STYLE },
    ]);
    expect(await textOnPage(result.bytes)).toContain(PUNCTUATION);
  });
});
