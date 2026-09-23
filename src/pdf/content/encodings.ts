/**
 * The single-byte encodings a simple font may use, as code to Unicode.
 *
 * WinAnsi is Windows code page 1252: Latin-1 except for 0x80–0x9F, so only
 * that stretch is written out. MacRoman differs from Latin-1 above 0x7F
 * altogether and is given in full. Standard encoding is close enough to
 * ASCII below 0x80 that only its upper half is worth stating.
 *
 * These are character mappings, not text: they are what the code 0xE9 means
 * in each encoding, and nothing here is copied from a font.
 */

export type EncodingName = 'WinAnsiEncoding' | 'MacRomanEncoding' | 'StandardEncoding';

const WIN_ANSI_UPPER: Record<number, number> = {
  0x80: 0x20ac,
  0x82: 0x201a,
  0x83: 0x0192,
  0x84: 0x201e,
  0x85: 0x2026,
  0x86: 0x2020,
  0x87: 0x2021,
  0x88: 0x02c6,
  0x89: 0x2030,
  0x8a: 0x0160,
  0x8b: 0x2039,
  0x8c: 0x0152,
  0x8e: 0x017d,
  0x91: 0x2018,
  0x92: 0x2019,
  0x93: 0x201c,
  0x94: 0x201d,
  0x95: 0x2022,
  0x96: 0x2013,
  0x97: 0x2014,
  0x98: 0x02dc,
  0x99: 0x2122,
  0x9a: 0x0161,
  0x9b: 0x203a,
  0x9c: 0x0153,
  0x9e: 0x017e,
  0x9f: 0x0178,
};

const MAC_ROMAN_UPPER = [
  0x00c4, 0x00c5, 0x00c7, 0x00c9, 0x00d1, 0x00d6, 0x00dc, 0x00e1, 0x00e0, 0x00e2, 0x00e4, 0x00e3,
  0x00e5, 0x00e7, 0x00e9, 0x00e8, 0x00ea, 0x00eb, 0x00ed, 0x00ec, 0x00ee, 0x00ef, 0x00f1, 0x00f3,
  0x00f2, 0x00f4, 0x00f6, 0x00f5, 0x00fa, 0x00f9, 0x00fb, 0x00fc, 0x2020, 0x00b0, 0x00a2, 0x00a3,
  0x00a7, 0x2022, 0x00b6, 0x00df, 0x00ae, 0x00a9, 0x2122, 0x00b4, 0x00a8, 0x2260, 0x00c6, 0x00d8,
  0x221e, 0x00b1, 0x2264, 0x2265, 0x00a5, 0x00b5, 0x2202, 0x2211, 0x220f, 0x03c0, 0x222b, 0x00aa,
  0x00ba, 0x03a9, 0x00e6, 0x00f8, 0x00bf, 0x00a1, 0x00ac, 0x221a, 0x0192, 0x2248, 0x2206, 0x00ab,
  0x00bb, 0x2026, 0x00a0, 0x00c0, 0x00c3, 0x00d5, 0x0152, 0x0153, 0x2013, 0x2014, 0x201c, 0x201d,
  0x2018, 0x2019, 0x00f7, 0x25ca, 0x00ff, 0x0178, 0x2044, 0x20ac, 0x2039, 0x203a, 0xfb01, 0xfb02,
  0x2021, 0x00b7, 0x201a, 0x201e, 0x2030, 0x00c2, 0x00ca, 0x00c1, 0x00cb, 0x00c8, 0x00cd, 0x00ce,
  0x00cf, 0x00cc, 0x00d3, 0x00d4, 0xf8ff, 0x00d2, 0x00da, 0x00db, 0x00d9, 0x0131, 0x02c6, 0x02dc,
  0x00af, 0x02d8, 0x02d9, 0x02da, 0x00b8, 0x02dd, 0x02db, 0x02c7,
];

/** Standard encoding above 0x7F, which is mostly punctuation and accents. */
const STANDARD_UPPER: Record<number, number> = {
  0xa1: 0x00a1,
  0xa2: 0x00a2,
  0xa3: 0x00a3,
  0xa4: 0x2044,
  0xa5: 0x00a5,
  0xa6: 0x0192,
  0xa7: 0x00a7,
  0xa8: 0x00a4,
  0xa9: 0x0027,
  0xaa: 0x201c,
  0xab: 0x00ab,
  0xac: 0x2039,
  0xad: 0x203a,
  0xae: 0xfb01,
  0xaf: 0xfb02,
  0xb1: 0x2013,
  0xb2: 0x2020,
  0xb3: 0x2021,
  0xb4: 0x00b7,
  0xb6: 0x00b6,
  0xb7: 0x2022,
  0xb8: 0x201a,
  0xb9: 0x201e,
  0xba: 0x201d,
  0xbb: 0x00bb,
  0xbc: 0x2026,
  0xbd: 0x2030,
  0xbf: 0x00bf,
  0xc1: 0x0060,
  0xc2: 0x00b4,
  0xc3: 0x02c6,
  0xc4: 0x02dc,
  0xc5: 0x00af,
  0xc6: 0x02d8,
  0xc7: 0x02d9,
  0xc8: 0x00a8,
  0xca: 0x02da,
  0xcb: 0x00b8,
  0xcd: 0x02dd,
  0xce: 0x02db,
  0xcf: 0x02c7,
  0xd0: 0x2014,
  0xe1: 0x00c6,
  0xe3: 0x00aa,
  0xe8: 0x0141,
  0xe9: 0x00d8,
  0xea: 0x0152,
  0xeb: 0x00ba,
  0xf1: 0x00e6,
  0xf5: 0x0131,
  0xf8: 0x0142,
  0xf9: 0x00f8,
  0xfa: 0x0153,
  0xfb: 0x00df,
};

/** What a code means in an encoding, or null when it means nothing. */
export function unicodeForCode(encoding: EncodingName, code: number): string | null {
  if (code < 0 || code > 0xff) return null;

  if (encoding === 'MacRomanEncoding') {
    if (code < 0x80) return String.fromCharCode(code);
    return String.fromCharCode(MAC_ROMAN_UPPER[code - 0x80] ?? code);
  }

  if (encoding === 'StandardEncoding') {
    if (code < 0x80) return String.fromCharCode(code);
    const point = STANDARD_UPPER[code];
    return point === undefined ? null : String.fromCharCode(point);
  }

  const point = WIN_ANSI_UPPER[code];
  if (point !== undefined) return String.fromCharCode(point);
  // 0x81, 0x8D, 0x8F, 0x90 and 0x9D are not defined in WinAnsi.
  if (code >= 0x80 && code <= 0x9f) return null;
  return String.fromCharCode(code);
}

/** The code that writes a character in an encoding, or null when none does. */
export function codeForUnicode(encoding: EncodingName, character: string): number | null {
  const point = character.codePointAt(0);
  if (point === undefined) return null;

  if (encoding === 'WinAnsiEncoding') {
    for (const [code, mapped] of Object.entries(WIN_ANSI_UPPER)) {
      if (mapped === point) return Number(code);
    }
    if (point >= 0x80 && point <= 0x9f) return null;
    return point <= 0xff ? point : null;
  }

  if (encoding === 'MacRomanEncoding') {
    if (point < 0x80) return point;
    const index = MAC_ROMAN_UPPER.indexOf(point);
    return index < 0 ? null : index + 0x80;
  }

  if (point < 0x80) return point;
  for (const [code, mapped] of Object.entries(STANDARD_UPPER)) {
    if (mapped === point) return Number(code);
  }
  return null;
}

/**
 * The Unicode a glyph name stands for.
 *
 * Only the forms that can be worked out rather than looked up: the `uniXXXX`
 * and `uXXXX` conventions, a name that is already a single character, and the
 * names of the ASCII punctuation, which are the ones a `/Differences` array
 * uses in practice. Anything else is unknown, and the font's `ToUnicode` map
 * is what a well-made PDF provides for it.
 */
export function unicodeForGlyphName(name: string): string | null {
  const stripped = name.replace(/\..*$/, '');
  if (stripped === '') return null;

  const uni = /^uni([0-9A-Fa-f]{4,6})$/.exec(stripped);
  if (uni !== null) return String.fromCodePoint(Number.parseInt(uni[1] as string, 16));

  const u = /^u([0-9A-Fa-f]{4,6})$/.exec(stripped);
  if (u !== null) return String.fromCodePoint(Number.parseInt(u[1] as string, 16));

  if (stripped.length === 1) return stripped;

  const known = GLYPH_NAMES[stripped];
  return known === undefined ? null : known;
}

/** The glyph names that are not simply the character they stand for. */
const GLYPH_NAMES: Record<string, string> = {
  space: ' ',
  exclam: '!',
  quotedbl: '"',
  numbersign: '#',
  dollar: '$',
  percent: '%',
  ampersand: '&',
  quotesingle: "'",
  quoteright: '’',
  quoteleft: '‘',
  quotedblleft: '“',
  quotedblright: '”',
  parenleft: '(',
  parenright: ')',
  asterisk: '*',
  plus: '+',
  comma: ',',
  hyphen: '-',
  period: '.',
  slash: '/',
  zero: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  colon: ':',
  semicolon: ';',
  less: '<',
  equal: '=',
  greater: '>',
  question: '?',
  at: '@',
  bracketleft: '[',
  backslash: '\\',
  bracketright: ']',
  asciicircum: '^',
  underscore: '_',
  grave: '`',
  braceleft: '{',
  bar: '|',
  braceright: '}',
  asciitilde: '~',
  endash: '–',
  emdash: '—',
  bullet: '•',
  ellipsis: '…',
  fi: 'ﬁ',
  fl: 'ﬂ',
  nbspace: ' ',
  germandbls: 'ß',
  adieresis: 'ä',
  odieresis: 'ö',
  udieresis: 'ü',
  Adieresis: 'Ä',
  Odieresis: 'Ö',
  Udieresis: 'Ü',
  eacute: 'é',
  egrave: 'è',
  ecircumflex: 'ê',
  agrave: 'à',
  acircumflex: 'â',
  ccedilla: 'ç',
  ugrave: 'ù',
  ocircumflex: 'ô',
  icircumflex: 'î',
};
