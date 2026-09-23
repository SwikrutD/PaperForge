import type { ContentValue } from './values';

/**
 * The content stream parser.
 *
 * A page's drawing is a sequence of operations: some operands, then the
 * operator that consumes them. This reads that sequence and — the part that
 * matters for editing — records where every operand begins and ends in the
 * bytes, so one can be written again without touching anything around it.
 *
 * Nothing here interprets what an operation means; that is `state.ts` and
 * `textRuns.ts`. A stream that is damaged part way through yields the
 * operations up to the damage rather than nothing at all.
 */

export interface ByteRange {
  start: number;
  /** Exclusive, as a slice takes it. */
  end: number;
}

export interface ContentOperation {
  operator: string;
  operands: ContentValue[];
  /** Where each operand sits in the stream, in the same order. */
  operandRanges: ByteRange[];
  /** The whole operation, from its first operand to the end of the operator. */
  range: ByteRange;
  /**
   * For an inline image, the bytes between `ID` and `EI`. They are never
   * parsed: the image data can contain anything, including `EI`.
   */
  inlineImageData?: ByteRange;
}

/** The byte values a content stream gives meaning to. */
const Byte = {
  Tab: 0x09,
  LineFeed: 0x0a,
  FormFeed: 0x0c,
  Return: 0x0d,
  Space: 0x20,
  Null: 0x00,
  Percent: 0x25,
  Slash: 0x2f,
  OpenParen: 0x28,
  CloseParen: 0x29,
  OpenAngle: 0x3c,
  CloseAngle: 0x3e,
  OpenBracket: 0x5b,
  CloseBracket: 0x5d,
  OpenBrace: 0x7b,
  CloseBrace: 0x7d,
  Backslash: 0x5c,
} as const satisfies Record<string, number>;

function isWhitespace(byte: number): boolean {
  return (
    byte === Byte.Space ||
    byte === Byte.LineFeed ||
    byte === Byte.Return ||
    byte === Byte.Tab ||
    byte === Byte.FormFeed ||
    byte === Byte.Null
  );
}

function isDelimiter(byte: number): boolean {
  return (
    byte === Byte.OpenParen ||
    byte === Byte.CloseParen ||
    byte === Byte.OpenAngle ||
    byte === Byte.CloseAngle ||
    byte === Byte.OpenBracket ||
    byte === Byte.CloseBracket ||
    byte === Byte.OpenBrace ||
    byte === Byte.CloseBrace ||
    byte === Byte.Slash ||
    byte === Byte.Percent
  );
}

function isRegular(byte: number): boolean {
  return !isWhitespace(byte) && !isDelimiter(byte);
}

/** How deep an array or dictionary may nest before the stream is nonsense. */
const MAX_DEPTH = 32;

class Scanner {
  offset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  get done(): boolean {
    return this.offset >= this.bytes.length;
  }

  peek(ahead = 0): number {
    return this.bytes[this.offset + ahead] ?? -1;
  }

  skipWhitespace(): void {
    while (!this.done) {
      const byte = this.peek();
      if (isWhitespace(byte)) {
        this.offset += 1;
        continue;
      }
      // A comment runs to the end of its line and counts as whitespace.
      if (byte === Byte.Percent) {
        while (!this.done && this.peek() !== Byte.LineFeed && this.peek() !== Byte.Return) {
          this.offset += 1;
        }
        continue;
      }
      return;
    }
  }

  /** The run of regular characters starting here: a number, or an operator. */
  readToken(): string {
    const start = this.offset;
    while (!this.done && isRegular(this.peek())) this.offset += 1;
    return latin1(this.bytes, start, this.offset);
  }

  readName(): string {
    this.offset += 1; // the slash
    const start = this.offset;
    while (!this.done && isRegular(this.peek())) this.offset += 1;
    return decodeName(latin1(this.bytes, start, this.offset));
  }

  /** A `(…)` string, with nesting, escapes and octal codes resolved. */
  readLiteralString(): Uint8Array {
    this.offset += 1; // the opening paren
    const out: number[] = [];
    let depth = 1;

    while (!this.done) {
      const byte = this.peek();
      this.offset += 1;

      if (byte === Byte.Backslash) {
        const escaped = this.peek();
        this.offset += 1;
        switch (escaped) {
          case 0x6e: // n
            out.push(Byte.LineFeed);
            break;
          case 0x72: // r
            out.push(Byte.Return);
            break;
          case 0x74: // t
            out.push(Byte.Tab);
            break;
          case 0x62: // b
            out.push(0x08);
            break;
          case 0x66: // f
            out.push(Byte.FormFeed);
            break;
          case Byte.LineFeed:
            break; // a line continuation writes nothing
          case Byte.Return:
            if (this.peek() === Byte.LineFeed) this.offset += 1;
            break;
          default:
            if (escaped >= 0x30 && escaped <= 0x37) {
              let code = escaped - 0x30;
              for (let digit = 0; digit < 2; digit += 1) {
                const next = this.peek();
                if (next < 0x30 || next > 0x37) break;
                code = code * 8 + (next - 0x30);
                this.offset += 1;
              }
              out.push(code & 0xff);
            } else if (escaped >= 0) {
              out.push(escaped);
            }
        }
        continue;
      }

      if (byte === Byte.OpenParen) {
        depth += 1;
        out.push(byte);
        continue;
      }
      if (byte === Byte.CloseParen) {
        depth -= 1;
        if (depth === 0) break;
        out.push(byte);
        continue;
      }
      out.push(byte);
    }

    return Uint8Array.from(out);
  }

  /** A `<…>` string; an odd last digit is padded with zero, as PDF says. */
  readHexString(): Uint8Array {
    this.offset += 1; // the opening angle
    const digits: number[] = [];

    while (!this.done) {
      const byte = this.peek();
      this.offset += 1;
      if (byte === Byte.CloseAngle) break;
      const digit = hexValue(byte);
      if (digit >= 0) digits.push(digit);
    }

    if (digits.length % 2 === 1) digits.push(0);
    const out = new Uint8Array(digits.length / 2);
    for (let index = 0; index < out.length; index += 1) {
      out[index] = ((digits[index * 2] as number) << 4) | (digits[index * 2 + 1] as number);
    }
    return out;
  }
}

function latin1(bytes: Uint8Array, start: number, end: number): string {
  let text = '';
  for (let index = start; index < end; index += 1) text += String.fromCharCode(bytes[index] ?? 0);
  return text;
}

function hexValue(byte: number): number {
  if (byte >= 0x30 && byte <= 0x39) return byte - 0x30;
  if (byte >= 0x41 && byte <= 0x46) return byte - 0x41 + 10;
  if (byte >= 0x61 && byte <= 0x66) return byte - 0x61 + 10;
  return -1;
}

/** `#41` in a name means "A". */
function decodeName(raw: string): string {
  return raw.replace(/#([0-9a-fA-F]{2})/g, (_match, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
}

interface ParsedValue {
  value: ContentValue;
  range: ByteRange;
}

/** Reads one value, or null when what comes next is an operator. */
function readValue(scanner: Scanner, depth: number): ParsedValue | null {
  scanner.skipWhitespace();
  if (scanner.done) return null;

  const start = scanner.offset;
  const byte = scanner.peek();

  if (byte === Byte.Slash) {
    const value = scanner.readName();
    return { value: { kind: 'name', value }, range: { start, end: scanner.offset } };
  }

  if (byte === Byte.OpenParen) {
    const bytes = scanner.readLiteralString();
    return { value: { kind: 'string', bytes, hex: false }, range: { start, end: scanner.offset } };
  }

  if (byte === Byte.OpenAngle) {
    if (scanner.peek(1) === Byte.OpenAngle) {
      if (depth >= MAX_DEPTH) return null;
      scanner.offset += 2;
      const entries = new Map<string, ContentValue>();

      for (;;) {
        scanner.skipWhitespace();
        if (scanner.done) break;
        if (scanner.peek() === Byte.CloseAngle && scanner.peek(1) === Byte.CloseAngle) {
          scanner.offset += 2;
          break;
        }
        if (scanner.peek() !== Byte.Slash) {
          // Anything that is not a key means the dictionary is malformed.
          scanner.offset += 1;
          continue;
        }
        const key = scanner.readName();
        const entry = readValue(scanner, depth + 1);
        if (entry === null) break;
        entries.set(key, entry.value);
      }
      return { value: { kind: 'dict', entries }, range: { start, end: scanner.offset } };
    }

    const bytes = scanner.readHexString();
    return { value: { kind: 'string', bytes, hex: true }, range: { start, end: scanner.offset } };
  }

  if (byte === Byte.OpenBracket) {
    if (depth >= MAX_DEPTH) return null;
    scanner.offset += 1;
    const items: ContentValue[] = [];

    for (;;) {
      scanner.skipWhitespace();
      if (scanner.done) break;
      if (scanner.peek() === Byte.CloseBracket) {
        scanner.offset += 1;
        break;
      }
      const item = readValue(scanner, depth + 1);
      if (item === null) {
        // An operator inside an array means the array never closed.
        break;
      }
      items.push(item.value);
    }
    return { value: { kind: 'array', items }, range: { start, end: scanner.offset } };
  }

  if (byte === Byte.CloseBracket || byte === Byte.CloseAngle || byte === Byte.CloseBrace) {
    // A stray closer belongs to nothing; stepping over it keeps parsing.
    scanner.offset += 1;
    return readValue(scanner, depth);
  }

  const token = scanner.readToken();
  if (token === '') {
    scanner.offset += 1;
    return readValue(scanner, depth);
  }

  if (token === 'true' || token === 'false') {
    return {
      value: { kind: 'boolean', value: token === 'true' },
      range: { start, end: scanner.offset },
    };
  }
  if (token === 'null') {
    return { value: { kind: 'null' }, range: { start, end: scanner.offset } };
  }

  if (/^[+-]?(\d+\.?\d*|\.\d+|\.)$/.test(token)) {
    const value = Number.parseFloat(token);
    return {
      value: { kind: 'number', value: Number.isFinite(value) ? value : 0 },
      range: { start, end: scanner.offset },
    };
  }

  // Not a value: the scanner is left where the token began so the caller can
  // read it as an operator.
  scanner.offset = start;
  return null;
}

/** Finds the end of an inline image: `EI` on a delimiter, after `ID`. */
function readInlineImage(bytes: Uint8Array, from: number): ByteRange {
  // One whitespace byte after ID belongs to the operator, not the data.
  const dataStart = isWhitespace(bytes[from] ?? 0) ? from + 1 : from;

  for (let index = dataStart; index + 1 < bytes.length; index += 1) {
    if (bytes[index] !== 0x45 || bytes[index + 1] !== 0x49) continue; // E I
    const before = bytes[index - 1] ?? 0;
    const after = bytes[index + 2] ?? Byte.Space;
    if (isWhitespace(before) && (isWhitespace(after) || isDelimiter(after))) {
      return { start: dataStart, end: index };
    }
  }
  return { start: dataStart, end: bytes.length };
}

/**
 * Parses a content stream into its operations.
 *
 * Operands are collected until an operator appears, which is exactly how a
 * content stream is defined: postfix, with no punctuation between operations.
 */
export function parseContent(bytes: Uint8Array): ContentOperation[] {
  const scanner = new Scanner(bytes);
  const operations: ContentOperation[] = [];

  let operands: ContentValue[] = [];
  let operandRanges: ByteRange[] = [];

  while (!scanner.done) {
    const parsed = readValue(scanner, 0);
    if (parsed !== null) {
      operands.push(parsed.value);
      operandRanges.push(parsed.range);
      continue;
    }

    scanner.skipWhitespace();
    if (scanner.done) break;

    const start = scanner.offset;
    const operator = scanner.readToken();
    if (operator === '') {
      scanner.offset += 1;
      continue;
    }

    const operation: ContentOperation = {
      operator,
      operands,
      operandRanges,
      range: { start: operandRanges[0]?.start ?? start, end: scanner.offset },
    };

    if (operator === 'ID') {
      const data = readInlineImage(bytes, scanner.offset);
      operation.inlineImageData = data;
      // Step over the data and the EI that ends it.
      scanner.offset = Math.min(bytes.length, data.end + 2);
      operation.range = { start: operation.range.start, end: scanner.offset };
    }

    operations.push(operation);
    operands = [];
    operandRanges = [];
  }

  return operations;
}
