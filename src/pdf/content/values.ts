/**
 * The values a content stream operator takes.
 *
 * A content stream is not the document's object graph: it has no references,
 * no streams and no indirect objects, only the handful of value kinds below.
 * They are kept as they were written — a string as its bytes, a number as
 * written — because what is read here is later written back.
 */

export type ContentValue =
  | { kind: 'number'; value: number }
  | { kind: 'name'; value: string }
  /** A literal `(…)` or hexadecimal `<…>` string, as its bytes. */
  | { kind: 'string'; bytes: Uint8Array; hex: boolean }
  | { kind: 'array'; items: ContentValue[] }
  | { kind: 'dict'; entries: Map<string, ContentValue> }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'null' };

/** The number a value holds, or a fallback when it is not a number. */
export function numberOf(value: ContentValue | undefined, fallback = 0): number {
  return value?.kind === 'number' ? value.value : fallback;
}

/** The name a value holds, without its slash, or null. */
export function nameOf(value: ContentValue | undefined): string | null {
  return value?.kind === 'name' ? value.value : null;
}

/** Every number in a value, which is what a colour operator amounts to. */
export function numbersOf(values: readonly ContentValue[]): number[] {
  return values.filter((value) => value.kind === 'number').map((value) => value.value);
}

/** Writes a value back out the way a content stream spells it. */
export function formatValue(value: ContentValue): string {
  switch (value.kind) {
    case 'number':
      return formatNumber(value.value);
    case 'name':
      return `/${value.value}`;
    case 'string':
      return value.hex ? `<${toHex(value.bytes)}>` : `(${escapeLiteral(value.bytes)})`;
    case 'array':
      return `[${value.items.map(formatValue).join(' ')}]`;
    case 'dict':
      return `<< ${[...value.entries]
        .map(([key, entry]) => `/${key} ${formatValue(entry)}`)
        .join(' ')} >>`;
    case 'boolean':
      return value.value ? 'true' : 'false';
    case 'null':
      return 'null';
  }
}

/** PDF numbers have no exponent form, and trailing zeros are noise. */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

function toHex(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) text += byte.toString(16).padStart(2, '0');
  return text.toUpperCase();
}

/**
 * Escapes a string the way a content stream must: the three characters that
 * would end or nest the string, and anything unprintable as an octal code.
 */
export function escapeLiteral(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) {
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) text += `\\${String.fromCharCode(byte)}`;
    else if (byte === 0x0a) text += '\\n';
    else if (byte === 0x0d) text += '\\r';
    else if (byte === 0x09) text += '\\t';
    else if (byte < 0x20 || byte > 0x7e) text += `\\${byte.toString(8).padStart(3, '0')}`;
    else text += String.fromCharCode(byte);
  }
  return text;
}
