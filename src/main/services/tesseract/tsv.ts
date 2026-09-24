import type { OcrWord } from '@shared/schemas/ocr';

/**
 * Reading Tesseract's TSV.
 *
 * Tesseract writes one row per thing it found — page, block, paragraph, line,
 * word — with the box it found it in. Only the words matter here, and only
 * the ones it actually read something for.
 */

const HEADER = 'level';
const WORD_LEVEL = 5;

export interface ParsedPage {
  words: OcrWord[];
  /** The words joined line by line, in the order they were read. */
  text: string;
  /** The average confidence of the words, or null when there are none. */
  confidence: number | null;
}

export function parseTsv(tsv: string): ParsedPage {
  const words: OcrWord[] = [];
  let lineKey = '';
  let lineIndex = -1;

  for (const row of tsv.split(/\r?\n/)) {
    if (row === '' || row.startsWith(HEADER)) continue;

    const columns = row.split('\t');
    if (columns.length < 12) continue;
    if (Number(columns[0]) !== WORD_LEVEL) continue;

    // Everything after the eleventh column is the word itself: a word cannot
    // contain a tab, but being generous here costs nothing.
    const text = columns.slice(11).join('\t').trim();
    if (text === '') continue;

    const key = `${columns[2] ?? ''}:${columns[3] ?? ''}:${columns[4] ?? ''}`;
    if (key !== lineKey) {
      lineKey = key;
      lineIndex += 1;
    }

    const numbers = [6, 7, 8, 9].map((index) => Number(columns[index]));
    if (numbers.some((value) => !Number.isFinite(value))) continue;
    const [left = 0, top = 0, width = 0, height = 0] = numbers;

    const confidence = Number(columns[10]);
    words.push({
      text,
      left: Math.max(0, Math.round(left)),
      top: Math.max(0, Math.round(top)),
      width: Math.max(0, Math.round(width)),
      height: Math.max(0, Math.round(height)),
      confidence: Number.isFinite(confidence) ? confidence : -1,
      line: lineIndex,
    });
  }

  return { words, text: joinLines(words), confidence: averageConfidence(words) };
}

/** The words as a reader would read them: one line of the page per line. */
export function joinLines(words: readonly OcrWord[]): string {
  const lines: string[][] = [];
  for (const word of words) {
    const line = lines[word.line] ?? [];
    line.push(word.text);
    lines[word.line] = line;
  }
  return lines
    .filter((line) => line !== undefined)
    .map((line) => line.join(' '))
    .join('\n');
}

function averageConfidence(words: readonly OcrWord[]): number | null {
  const scored = words.filter((word) => word.confidence >= 0);
  if (scored.length === 0) return null;
  const total = scored.reduce((sum, word) => sum + word.confidence, 0);
  return Math.round((total / scored.length) * 10) / 10;
}
