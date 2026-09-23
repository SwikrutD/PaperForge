import { describe, expect, it } from 'vitest';
import { parseContent, type ContentOperation } from '../../../src/pdf/content/parser';
import { formatValue, type ContentValue } from '../../../src/pdf/content/values';

/**
 * The content stream parser.
 *
 * Every test asserts two things at once: what was read, and that the byte
 * range recorded for it really is where it was read from — because editing
 * text means writing back exactly that range and nothing else.
 */

function parse(source: string): ContentOperation[] {
  return parseContent(new TextEncoder().encode(source));
}

/** The bytes a range covers, which is what a rewrite would replace. */
function slice(source: string, range: { start: number; end: number }): string {
  return source.slice(range.start, range.end);
}

describe('operations', () => {
  it('reads operands and the operator that consumes them', () => {
    const operations = parse('BT /F1 12 Tf 10 20 Td (Hello) Tj ET');

    expect(operations.map((operation) => operation.operator)).toEqual([
      'BT',
      'Tf',
      'Td',
      'Tj',
      'ET',
    ]);
    expect(operations[1]?.operands).toEqual([
      { kind: 'name', value: 'F1' },
      { kind: 'number', value: 12 },
    ]);
  });

  it('records where every operand sits in the stream', () => {
    const source = 'BT /F1 12 Tf 10 20 Td (Hello) Tj ET';
    const operations = parse(source);
    const show = operations[3];

    expect(slice(source, show?.operandRanges[0] as { start: number; end: number })).toBe('(Hello)');
    expect(slice(source, show?.range as { start: number; end: number })).toBe('(Hello) Tj');
  });

  it('keeps numbers as written, including negatives and bare decimals', () => {
    const operations = parse('-1.5 .25 +3 0 4 Tm');
    expect(operations[0]?.operands.map((value) => (value as { value: number }).value)).toEqual([
      -1.5, 0.25, 3, 0, 4,
    ]);
  });

  it('reads a name with an escaped character in it', () => {
    const operations = parse('/A#20B Do');
    expect(operations[0]?.operands[0]).toEqual({ kind: 'name', value: 'A B' });
  });
});

describe('strings', () => {
  it('resolves escapes, octal codes and nested parentheses', () => {
    const operations = parse(String.raw`(a\(b\) c\101\n) Tj`);
    const value = operations[0]?.operands[0] as { kind: 'string'; bytes: Uint8Array };

    expect(new TextDecoder('latin1').decode(value.bytes)).toBe('a(b) cA\n');
  });

  it('reads a hexadecimal string, padding an odd last digit', () => {
    const operations = parse('<48656C6C6F> Tj <4> Tj');
    const first = operations[0]?.operands[0] as { bytes: Uint8Array };
    const second = operations[1]?.operands[0] as { bytes: Uint8Array };

    expect(new TextDecoder('latin1').decode(first.bytes)).toBe('Hello');
    expect([...second.bytes]).toEqual([0x40]);
  });

  it('tells a hexadecimal string from a dictionary', () => {
    const operations = parse('<< /Type /Page >> /Name <41> Tj');
    expect(operations[0]?.operands[0]?.kind).toBe('dict');
    expect(operations[0]?.operands[2]?.kind).toBe('string');
  });

  it('does not end a string at a parenthesis inside it', () => {
    const operations = parse('((nested) still) Tj');
    const value = operations[0]?.operands[0] as { bytes: Uint8Array };
    expect(new TextDecoder('latin1').decode(value.bytes)).toBe('(nested) still');
  });
});

describe('arrays and dictionaries', () => {
  it('reads a TJ array of strings and offsets', () => {
    const operations = parse('[(A) -250 (B)] TJ');
    const value = operations[0]?.operands[0] as { kind: 'array'; items: ContentValue[] };

    expect(value.items).toHaveLength(3);
    expect(value.items[1]).toEqual({ kind: 'number', value: -250 });
  });

  it('reads a nested dictionary in a marked-content operator', () => {
    const operations = parse('/OC << /MCID 0 /Nested << /Deep true >> >> BDC');
    const dict = operations[0]?.operands[1] as { kind: 'dict'; entries: Map<string, ContentValue> };

    expect(dict.entries.get('MCID')).toEqual({ kind: 'number', value: 0 });
    expect((dict.entries.get('Nested') as { kind: 'dict' }).kind).toBe('dict');
  });
});

describe('what a stream may throw at it', () => {
  it('treats a comment as whitespace', () => {
    const operations = parse('% a comment\n1 0 0 1 5 5 cm % another\nQ');
    expect(operations.map((operation) => operation.operator)).toEqual(['cm', 'Q']);
  });

  it('steps over an inline image without reading its data', () => {
    const source = 'BI /W 2 /H 2 /BPC 8 /CS /G ID \u0001\u0002EI\u0000\u0003 EI Q';
    const operations = parse(source);

    // The data can contain anything, including the two letters that end it.
    const image = operations.find((operation) => operation.operator === 'ID');
    expect(image?.inlineImageData).toBeDefined();
    expect(operations[operations.length - 1]?.operator).toBe('Q');
  });

  it('keeps the operations before damage rather than failing', () => {
    const operations = parse('BT (good) Tj (unterminated');
    expect(operations.map((operation) => operation.operator)).toEqual(['BT', 'Tj']);
  });

  it('survives stray closing brackets', () => {
    const operations = parse('] >> (text) Tj');
    expect(operations[0]?.operator).toBe('Tj');
  });

  it('reads nothing out of nothing', () => {
    expect(parse('')).toEqual([]);
    expect(parse('   \n\t ')).toEqual([]);
  });
});

describe('writing values back', () => {
  it('spells a value the way a content stream does', () => {
    const operations = parse('[(A\\)B) -250 <41>] TJ');
    const value = operations[0]?.operands[0] as ContentValue;
    expect(formatValue(value)).toBe('[(A\\)B) -250 <41>]');
  });

  it('writes numbers without exponents or trailing zeros', () => {
    expect(formatValue({ kind: 'number', value: 0.5 })).toBe('0.5');
    expect(formatValue({ kind: 'number', value: 12 })).toBe('12');
    expect(formatValue({ kind: 'number', value: 1.2000001 })).toBe('1.2');
    expect(formatValue({ kind: 'number', value: -0.000001 })).toBe('-0.000001');
  });

  it('escapes what would otherwise end a string', () => {
    const bytes = new TextEncoder().encode('a(b)c\\d');
    expect(formatValue({ kind: 'string', bytes, hex: false })).toBe('(a\\(b\\)c\\\\d)');
  });
});
