import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { parseContent } from '../../../src/pdf/content/parser';
import { readPageContent, type PageContent } from '../../../src/pdf/content/pageContent';
import { extractTextRuns, runBounds, type TextRun } from '../../../src/pdf/content/textRuns';
import { applyMatrix, multiply, walkContent, IDENTITY } from '../../../src/pdf/content/state';
import { unicodeForCode, unicodeForGlyphName } from '../../../src/pdf/content/encodings';
import type { FontMetrics } from '../../../src/pdf/content/fonts';
import { buildPdf, type PdfSpec } from '../../fixtures/pdf';

/**
 * The text model: where a page's words are, what they say, and which bytes of
 * the content stream hold them.
 *
 * The fixtures state their own content streams, so each test says exactly
 * which operators it is about.
 */

/** A font where every glyph is 500 wide and says what its code says. */
const evenFont: FontMetrics = {
  name: 'F1',
  baseFont: 'Test',
  singleByte: true,
  embedded: false,
  codes: (bytes) => [...bytes],
  unicode: (code) => String.fromCharCode(code),
  width: () => 500,
  codeFor: (character) => character.codePointAt(0) ?? null,
  ascent: 750,
  descent: -250,
  positionsKnown: true,
};

function runsOf(source: string): TextRun[] {
  return extractTextRuns(parseContent(new TextEncoder().encode(source)), {
    fonts: () => evenFont,
  });
}

async function pageOf(spec: PdfSpec): Promise<PageContent> {
  const document = await PDFDocument.load(new Uint8Array(buildPdf(spec)), {
    updateMetadata: false,
  });
  return readPageContent(document, 0);
}

describe('the text state machine', () => {
  it('places a run where Tm puts it', () => {
    const [run] = runsOf('BT /F1 12 Tf 1 0 0 1 72 700 Tm (Hi) Tj ET');
    expect(run?.origin).toEqual({ x: 72, y: 700 });
    expect(run?.fontSize).toBe(12);
  });

  it('moves down a line with Td, TD and T*', () => {
    const runs = runsOf('BT /F1 10 Tf 20 TL 50 500 Td (one) Tj 0 -20 TD (two) Tj T* (three) Tj ET');
    expect(runs.map((run) => run.origin.y)).toEqual([500, 480, 460]);
    expect(runs.map((run) => run.origin.x)).toEqual([50, 50, 50]);
  });

  it('advances along the line as it draws', () => {
    // Two shows on one line: the second starts where the first ended.
    const runs = runsOf('BT /F1 10 Tf 0 0 Td (AB) Tj (C) Tj ET');
    // Two glyphs, half an em each, at ten points.
    expect(runs[1]?.origin.x).toBeCloseTo(10, 5);
  });

  it('takes the offsets in a TJ array into account', () => {
    const runs = runsOf('BT /F1 10 Tf 0 0 Td [(A) -1000 (B)] TJ (C) Tj ET');
    // One glyph (5), the offset (10) and another glyph (5).
    expect(runs[1]?.origin.x).toBeCloseTo(20, 5);
    // A whole em of gap separates two words, as PDF.js reads it too.
    expect(runs[0]?.text).toBe('A B');
  });

  it('applies character, word and horizontal spacing', () => {
    const plain = runsOf('BT /F1 10 Tf (A A) Tj ET')[0];
    const spaced = runsOf('BT /F1 10 Tf 2 Tc 3 Tw (A A) Tj ET')[0];
    const stretched = runsOf('BT /F1 10 Tf 200 Tz (A A) Tj ET')[0];

    expect(plain?.width).toBeCloseTo(15, 5);
    // Three glyphs at 2 each, and one space at 3 more.
    expect(spaced?.width).toBeCloseTo(15 + 6 + 3, 5);
    expect(stretched?.width).toBeCloseTo(30, 5);
  });

  it('carries the page transform into the run', () => {
    const [run] = runsOf('q 2 0 0 2 10 10 cm BT /F1 10 Tf 0 0 Td (A) Tj ET Q');
    expect(run?.origin).toEqual({ x: 10, y: 10 });
    // The page doubles everything it draws.
    expect(run?.width).toBeCloseTo(10, 5);
  });

  it('restores the transform a Q closes', () => {
    const runs = runsOf('q 2 0 0 2 0 0 cm BT /F1 10 Tf (A) Tj ET Q BT /F1 10 Tf (A) Tj ET');
    expect(runs[0]?.width).toBeCloseTo(10, 5);
    expect(runs[1]?.width).toBeCloseTo(5, 5);
  });

  it('reads the rotation and the colour a run is drawn in', () => {
    const [run] = runsOf('BT 1 0 0 rg /F1 10 Tf 0 1 -1 0 100 100 Tm (A) Tj ET');
    expect(run?.rotation).toBe(90);
    expect(run?.color).toEqual({ space: 'rgb', components: [1, 0, 0] });
  });

  it('knows text that draws nothing', () => {
    const [visible] = runsOf('BT /F1 10 Tf (A) Tj ET');
    const [hidden] = runsOf('BT /F1 10 Tf 3 Tr (A) Tj ET');
    expect(visible?.invisible).toBe(false);
    expect(hidden?.invisible).toBe(true);
  });

  it('reads the two operators that move and show at once', () => {
    // Both operators move to the next line first, then show.
    const runs = runsOf('BT /F1 10 Tf 12 TL 0 112 Td (one) \' 5 1 (two) " ET');
    expect(runs.map((run) => run.text)).toEqual(['one', 'two']);
    expect(runs.map((run) => run.origin.y)).toEqual([100, 88]);
    expect(runs[1]?.wordSpacing).toBe(5);
    expect(runs[1]?.charSpacing).toBe(1);
  });

  it('leaves the walk alone for operators it does not know', () => {
    const seen: string[] = [];
    walkContent(parseContent(new TextEncoder().encode('sh /Sh0 sh 0 0 m 10 10 l S')), {
      onOperation: (context) => seen.push(context.operation.operator),
    });
    expect(seen).toEqual(['sh', 'sh', 'm', 'l', 'S']);
  });
});

describe('matrices', () => {
  it('applies the first transform, then the second', () => {
    const scale = { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 };
    const move = { a: 1, b: 0, c: 0, d: 1, e: 5, f: 0 };
    // Scaling then moving is not the same as moving then scaling.
    expect(applyMatrix(multiply(scale, move), 1, 0)).toEqual({ x: 7, y: 0 });
    expect(applyMatrix(multiply(move, scale), 1, 0)).toEqual({ x: 12, y: 0 });
    expect(applyMatrix(IDENTITY, 3, 4)).toEqual({ x: 3, y: 4 });
  });
});

describe('what a run holds', () => {
  it('points at the bytes that hold its text', () => {
    const source = 'BT /F1 10 Tf (Hello) Tj ET';
    const [run] = runsOf(source);
    expect(source.slice(run?.textRange.start, run?.textRange.end)).toBe('(Hello)');
    expect(source.slice(run?.operationRange.start, run?.operationRange.end)).toBe('(Hello) Tj');
  });

  it('points at the whole array of a TJ', () => {
    const source = 'BT /F1 10 Tf [(A) -100 (B)] TJ ET';
    const [run] = runsOf(source);
    expect(source.slice(run?.textRange.start, run?.textRange.end)).toBe('[(A) -100 (B)]');
  });

  it('measures each glyph, so a caret can sit between two of them', () => {
    const [run] = runsOf('BT /F1 10 Tf (AB) Tj ET');
    expect(run?.glyphs.map((glyph) => glyph.offset)).toEqual([0, 5]);
    expect(run?.glyphs.map((glyph) => glyph.text)).toEqual(['A', 'B']);
  });

  it('gives a box that covers the whole run', () => {
    const [run] = runsOf('BT /F1 10 Tf 1 0 0 1 20 100 Tm (AB) Tj ET');
    const bounds = runBounds(run!);

    expect(bounds.x).toBeCloseTo(20, 5);
    expect(bounds.width).toBeCloseTo(10, 5);
    expect(bounds.y).toBeCloseTo(97.5, 5);
    expect(bounds.height).toBeCloseTo(10, 5);
  });
});

describe('reading a real page', () => {
  it('finds the words the page draws, and what drew them', async () => {
    const page = await pageOf({ pages: [{ text: 'Hello page' }] });

    expect(page.runs).toHaveLength(1);
    expect(page.runs[0]?.text).toBe('Hello page');
    expect(page.runs[0]?.fontName).toBe('F1');
    expect(page.runs[0]?.font?.baseFont).toBe('Helvetica');
    // Helvetica's own metrics, not a guess.
    expect(page.runs[0]?.width).toBeGreaterThan(100);
  });

  it('reads a width array when the font carries one', async () => {
    const page = await pageOf({
      pages: [{ content: 'BT /F2 10 Tf 0 0 Td (AA) Tj ET' }],
      fonts: [{ name: 'F2', widths: new Array(96).fill(0).map(() => 1000) }],
    });

    // Every glyph a full em wide, so two of them at ten points is twenty.
    expect(page.runs[0]?.width).toBeCloseTo(20, 5);
  });

  it('reads what a ToUnicode map says a code means', async () => {
    const page = await pageOf({
      pages: [{ content: 'BT /F2 10 Tf (AB) Tj ET' }],
      fonts: [{ name: 'F2', toUnicode: { 0x41: 'é', 0x42: 'ss' } }],
    });

    expect(page.runs[0]?.text).toBe('éss');
  });

  it('reads a Differences array when there is no ToUnicode', async () => {
    const page = await pageOf({
      pages: [{ content: 'BT /F2 10 Tf (AB) Tj ET' }],
      fonts: [{ name: 'F2', differences: { 0x41: 'eacute', 0x42: 'bullet' } }],
    });

    expect(page.runs[0]?.text).toBe('é•');
  });

  it('reads a composite font two bytes at a time', async () => {
    const page = await pageOf({
      pages: [{ content: 'BT /F2 10 Tf <00410042> Tj ET' }],
      fonts: [
        {
          name: 'F2',
          composite: true,
          toUnicode: { 0x41: 'A', 0x42: 'B' },
          cidWidths: { 0x41: 500, 0x42: 500 },
        },
      ],
    });

    expect(page.runs[0]?.text).toBe('AB');
    expect(page.runs[0]?.glyphs).toHaveLength(2);
    expect(page.runs[0]?.width).toBeCloseTo(10, 5);
  });

  it('joins the content streams of a page that has several', async () => {
    const page = await pageOf({ pages: [{ text: 'One stream' }] });
    expect(new TextDecoder('latin1').decode(page.bytes)).toContain('Tj');
  });
});

describe('encodings', () => {
  it('reads the characters WinAnsi puts above Latin-1', () => {
    expect(unicodeForCode('WinAnsiEncoding', 0x93)).toBe('“');
    expect(unicodeForCode('WinAnsiEncoding', 0xe9)).toBe('é');
    expect(unicodeForCode('WinAnsiEncoding', 0x81)).toBeNull();
  });

  it('reads MacRoman, which differs from Latin-1 entirely', () => {
    expect(unicodeForCode('MacRomanEncoding', 0x8e)).toBe('é');
    expect(unicodeForCode('MacRomanEncoding', 0x41)).toBe('A');
  });

  it('works out the glyph names that can be worked out', () => {
    expect(unicodeForGlyphName('uni00E9')).toBe('é');
    expect(unicodeForGlyphName('A')).toBe('A');
    expect(unicodeForGlyphName('quotedblleft')).toBe('“');
    expect(unicodeForGlyphName('g123')).toBeNull();
  });
});
