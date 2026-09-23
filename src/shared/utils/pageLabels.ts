import type { PageLabelStyle } from '../schemas/pages';

/**
 * How a PDF numbers its own pages.
 *
 * Shared so that reading a document's labels and offering to change them agree
 * on what each style looks like.
 */

const ROMAN: Array<[number, string]> = [
  [1000, 'M'],
  [900, 'CM'],
  [500, 'D'],
  [400, 'CD'],
  [100, 'C'],
  [90, 'XC'],
  [50, 'L'],
  [40, 'XL'],
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
];

export function toRoman(value: number): string {
  let left = Math.max(1, Math.trunc(value));
  let result = '';
  for (const [amount, numeral] of ROMAN) {
    while (left >= amount) {
      result += numeral;
      left -= amount;
    }
  }
  return result;
}

/** A, B … Z, AA, AB …, which is how PDF letters its pages. */
export function toLetters(value: number): string {
  const position = Math.max(1, Math.trunc(value));
  const letter = String.fromCharCode(65 + ((position - 1) % 26));
  return letter.repeat(Math.floor((position - 1) / 26) + 1);
}

/** The label a page would carry, as the document would print it. */
export function formatPageLabel(style: PageLabelStyle, prefix: string, value: number): string {
  switch (style) {
    case 'decimal':
      return `${prefix}${String(Math.max(1, Math.trunc(value)))}`;
    case 'romanLower':
      return `${prefix}${toRoman(value).toLowerCase()}`;
    case 'romanUpper':
      return `${prefix}${toRoman(value)}`;
    case 'letterLower':
      return `${prefix}${toLetters(value).toLowerCase()}`;
    case 'letterUpper':
      return `${prefix}${toLetters(value)}`;
    case 'none':
      // A range with no style is a prefix on its own, which is legal.
      return prefix;
  }
}
