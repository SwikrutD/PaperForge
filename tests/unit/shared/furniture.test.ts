import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { PdfLibMutationEngine } from '../../../src/pdf/mutate/pdfLibEngine';
import { furnitureOn, removeFurniture } from '../../../src/pdf/content/furniture';
import { contentBytes } from '../../../src/pdf/content/pageContent';
import { substitute } from '../../../src/pdf/mutate/furniture';
import { DEFAULT_TEXT_STYLE } from '../../../src/shared/schemas/text';
import type { StagedAsset } from '../../../src/pdf/mutate/types';
import { buildPdf } from '../../fixtures/pdf';
import { pngPixel } from '../../fixtures/images';

/**
 * Watermarks, backgrounds, headers and footers: drawn by PaperForge, marked
 * as its own, and removable without disturbing the page underneath.
 */

const engine = new PdfLibMutationEngine();

function documentOf(pages = 3): Uint8Array {
  return new Uint8Array(
    buildPdf({
      pages: Array.from({ length: pages }, (_, index) => ({ text: `Page ${index + 1}` })),
    }),
  );
}

async function pageText(bytes: Uint8Array, pageNumber = 1): Promise<string> {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  return new TextDecoder('latin1').decode(contentBytes(document, document.getPage(pageNumber - 1)));
}

const staged = new Map<string, StagedAsset>([
  ['token', { kind: 'image', bytes: pngPixel(20, 10), format: 'png', width: 20, height: 10 }],
]);

const watermark = {
  source: { kind: 'text' as const, text: 'DRAFT', style: { ...DEFAULT_TEXT_STYLE, size: 48 } },
  opacity: 0.3,
  rotation: 45,
  scale: 1,
  position: { horizontal: 'center' as const, vertical: 'middle' as const },
  behind: false,
};

describe('watermarks', () => {
  it('draws one on every page asked for, and nowhere else', async () => {
    const result = await engine.apply(documentOf(), [
      { kind: 'setWatermark', pages: [1, 3], watermark },
    ]);

    expect(await pageText(result.bytes, 1)).toContain('/PFWatermark BDC');
    expect(await pageText(result.bytes, 2)).not.toContain('/PFWatermark');
    expect(await pageText(result.bytes, 3)).toContain('(DRAFT) Tj');
  });

  it('leaves what the page already drew exactly as it was', async () => {
    const original = documentOf(1);
    const before = await pageText(original);
    const result = await engine.apply(original, [{ kind: 'setWatermark', pages: [1], watermark }]);

    expect(await pageText(result.bytes)).toContain(before.trim());
  });

  it('draws it under the page when asked to', async () => {
    const result = await engine.apply(documentOf(1), [
      { kind: 'setWatermark', pages: [1], watermark: { ...watermark, behind: true } },
    ]);

    const content = await pageText(result.bytes);
    expect(content.indexOf('/PFWatermark')).toBeLessThan(content.indexOf('(Page 1) Tj'));
  });

  it('replaces one it put there before rather than stacking them up', async () => {
    const once = await engine.apply(documentOf(1), [
      { kind: 'setWatermark', pages: [1], watermark },
    ]);
    const twice = await engine.apply(once.bytes, [
      {
        kind: 'setWatermark',
        pages: [1],
        watermark: {
          ...watermark,
          source: { kind: 'text', text: 'FINAL', style: DEFAULT_TEXT_STYLE },
        },
      },
    ]);

    const content = await pageText(twice.bytes);
    expect(content).toContain('(FINAL) Tj');
    expect(content).not.toContain('(DRAFT) Tj');
    expect(content.match(/PFWatermark BDC/g)).toHaveLength(1);
  });

  it('draws an image watermark with the transparency it was given', async () => {
    const result = await engine.apply(
      documentOf(1),
      [
        {
          kind: 'setWatermark',
          pages: [1],
          watermark: { ...watermark, source: { kind: 'image', token: 'token' }, opacity: 0.5 },
        },
      ],
      staged,
    );

    const content = await pageText(result.bytes);
    expect(content).toContain('/PFAlpha50 gs');
    expect(content).toMatch(/\/PFImg\d+ Do/);
  });
});

describe('backgrounds', () => {
  it('goes under everything the page draws', async () => {
    const result = await engine.apply(documentOf(1), [
      {
        kind: 'setBackground',
        pages: [1],
        background: { fill: { kind: 'color', color: { r: 1, g: 0.9, b: 0.8 } }, opacity: 1 },
      },
    ]);

    const content = await pageText(result.bytes);
    expect(content.indexOf('/PFBackground')).toBe(0);
    expect(content).toContain('re f');
    expect(content).toContain('(Page 1) Tj');
  });

  it('tiles an image across the page', async () => {
    const result = await engine.apply(
      documentOf(1),
      [
        {
          kind: 'setBackground',
          pages: [1],
          background: { fill: { kind: 'image', token: 'token', fit: 'tile' }, opacity: 1 },
        },
      ],
      staged,
    );

    const content = await pageText(result.bytes);
    expect((content.match(/Do/g) ?? []).length).toBeGreaterThan(4);
  });
});

describe('headers and footers', () => {
  const settings = {
    header: { left: '{{title}}', center: '', right: '{{date}}' },
    footer: { left: '', center: 'Page {{page}} of {{pages}}', right: '{{bates}}' },
    style: DEFAULT_TEXT_STYLE,
    margin: 36,
    startNumber: 1,
    bates: { prefix: 'ABC-', suffix: '', digits: 6, start: 1 },
    date: '23 September 2026',
    title: 'The Report',
  };

  it('puts the resolved text where it was asked for', async () => {
    const result = await engine.apply(documentOf(2), [
      { kind: 'setHeaderFooter', pages: [1, 2], settings },
    ]);

    const first = await pageText(result.bytes, 1);
    expect(first).toContain('/PFHeader BDC');
    expect(first).toContain('(The Report) Tj');
    expect(first).toContain('(23 September 2026) Tj');
    expect(first).toContain('(Page 1 of 2) Tj');
    expect(first).toContain('(ABC-000001) Tj');

    const second = await pageText(result.bytes, 2);
    expect(second).toContain('(Page 2 of 2) Tj');
    expect(second).toContain('(ABC-000002) Tj');
  });

  it('numbers from where it was told to start', async () => {
    const result = await engine.apply(documentOf(2), [
      {
        kind: 'setHeaderFooter',
        pages: [1, 2],
        settings: { ...settings, startNumber: 10, bates: { ...settings.bates, start: 500 } },
      },
    ]);

    expect(await pageText(result.bytes, 1)).toContain('(Page 10 of 2) Tj');
    expect(await pageText(result.bytes, 2)).toContain('(ABC-000501) Tj');
  });

  it('writes nothing for a line with nothing in it', async () => {
    const result = await engine.apply(documentOf(1), [
      {
        kind: 'setHeaderFooter',
        pages: [1],
        settings: { ...settings, header: { left: '', center: '', right: '' } },
      },
    ]);

    const content = await pageText(result.bytes);
    expect(content).not.toContain('/PFHeader');
    expect(content).toContain('/PFFooter');
  });
});

describe('taking furniture off again', () => {
  it('removes only what was asked for', async () => {
    const marked = await engine.apply(documentOf(1), [
      { kind: 'setWatermark', pages: [1], watermark },
      {
        kind: 'setBackground',
        pages: [1],
        background: { fill: { kind: 'color', color: { r: 0, g: 0, b: 1 } }, opacity: 1 },
      },
    ]);

    const result = await engine.apply(marked.bytes, [
      { kind: 'removeFurniture', pages: [1], kinds: ['watermark'] },
    ]);

    const content = await pageText(result.bytes);
    expect(content).not.toContain('PFWatermark');
    expect(content).toContain('PFBackground');
    expect(content).toContain('(Page 1) Tj');
  });

  it('leaves a page that carries none of it byte for byte as it was', async () => {
    const document = await PDFDocument.load(documentOf(1), { updateMetadata: false });
    const content = contentBytes(document, document.getPage(0));

    const result = removeFurniture(content, ['watermark', 'background', 'header', 'footer']);
    expect(result.removed).toBe(0);
    expect(result.bytes).toEqual(content);
  });

  it('says what a page carries', async () => {
    const marked = await engine.apply(documentOf(1), [
      { kind: 'setWatermark', pages: [1], watermark },
    ]);
    const document = await PDFDocument.load(marked.bytes, { updateMetadata: false });

    expect(furnitureOn(contentBytes(document, document.getPage(0)))).toEqual(['watermark']);
  });
});

describe('the tokens a line may carry', () => {
  it('puts the values in place of the names', () => {
    expect(
      substitute('{{title}} — {{page}}/{{pages}} — {{date}} — {{bates}}', {
        page: 3,
        pages: 12,
        date: 'today',
        title: 'A Report',
        bates: 'X-0003',
      }),
    ).toBe('A Report — 3/12 — today — X-0003');
  });

  it('leaves anything that is not a token alone', () => {
    expect(
      substitute('{page} {{unknown}}', {
        page: 1,
        pages: 1,
        date: '',
        title: '',
        bates: '',
      }),
    ).toBe('{page} {{unknown}}');
  });
});
