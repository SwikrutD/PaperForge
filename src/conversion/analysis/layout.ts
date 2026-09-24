import type { ExportTextItem } from '@shared/schemas/convert';

/**
 * Making sense of where the words are.
 *
 * A PDF says where every piece of text sits, not what any of it means: there
 * are no paragraphs in a PDF, and no tables. Everything here is a reading of
 * the geometry — lines from what shares a baseline, paragraphs from the gaps
 * between lines, columns from what lines up down the page — and every reading
 * can be wrong. That is why the exports that use it say so.
 */

export interface TextLine {
  /** The words of the line, in the order they are drawn. */
  items: ExportTextItem[];
  text: string;
  /** The baseline, in PDF units from the bottom of the page. */
  y: number;
  /** The left and right edges of the line. */
  left: number;
  right: number;
  /** The tallest piece of text on the line, which is the size to read it at. */
  height: number;
}

export interface TextBlock {
  lines: TextLine[];
  text: string;
  /** The size the block is set in, taken from its tallest line. */
  height: number;
  left: number;
  right: number;
  /** True when the block is set larger than the page's usual text. */
  heading: boolean;
}

/** Groups the pieces of text that share a line, top to bottom. */
export function toLines(items: readonly ExportTextItem[]): TextLine[] {
  const drawn = items.filter((item) => item.text.trim() !== '');
  if (drawn.length === 0) return [];

  // Two pieces are on the same line when their baselines are within a fraction
  // of the text's own height: a superscript should not start a new line.
  const sorted = [...drawn].sort((left, right) => right.y - left.y || left.x - right.x);
  const lines: TextLine[] = [];

  for (const item of sorted) {
    const tolerance = Math.max(1.5, item.height * 0.5);
    const line = lines[lines.length - 1];

    if (line !== undefined && Math.abs(line.y - item.y) <= tolerance) {
      line.items.push(item);
      line.left = Math.min(line.left, item.x);
      line.right = Math.max(line.right, item.x + item.width);
      line.height = Math.max(line.height, item.height);
      continue;
    }

    lines.push({
      items: [item],
      text: '',
      y: item.y,
      left: item.x,
      right: item.x + item.width,
      height: item.height,
    });
  }

  for (const line of lines) {
    line.items.sort((left, right) => left.x - right.x);
    line.text = joinItems(line.items);
  }
  return lines;
}

/**
 * Joins the pieces of a line into its words.
 *
 * A PDF often draws a line in several pieces with no spaces of their own, so
 * a gap wider than a space in that text means a space belongs there.
 */
function joinItems(items: readonly ExportTextItem[]): string {
  let text = '';
  let previous: ExportTextItem | undefined;

  for (const item of items) {
    if (previous !== undefined) {
      const gap = item.x - (previous.x + previous.width);
      const space = Math.max(1, Math.min(previous.height, item.height)) * 0.2;
      const ends = /\s$/.test(text);
      const starts = /^\s/.test(item.text);
      if (gap > space && !ends && !starts) text += ' ';
    }
    text += item.text;
    previous = item;
  }
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Groups lines into paragraphs.
 *
 * A new paragraph begins where the gap between lines grows, where the left
 * edge steps in or out, or where the text changes size — the same things a
 * reader uses, and just as fallible.
 */
export function toBlocks(lines: readonly TextLine[]): TextBlock[] {
  if (lines.length === 0) return [];

  const bodyHeight = median(lines.map((line) => line.height));
  const blocks: TextBlock[] = [];
  let current: TextLine[] = [];
  let previous: TextLine | undefined;

  const flush = (): void => {
    if (current.length === 0) return;
    blocks.push(makeBlock(current, bodyHeight));
    current = [];
  };

  for (const line of lines) {
    if (previous !== undefined) {
      const gap = previous.y - line.y;
      const spacing = Math.max(previous.height, line.height);
      const indented = Math.abs(line.left - previous.left) > spacing * 0.9;
      const resized = Math.abs(line.height - previous.height) > Math.max(1, spacing * 0.25);
      // A gap of more than one and a half lines is a new paragraph anywhere.
      if (gap > spacing * 1.6 || indented || resized) flush();
    }
    current.push(line);
    previous = line;
  }
  flush();

  return blocks;
}

function makeBlock(lines: readonly TextLine[], bodyHeight: number): TextBlock {
  const height = Math.max(...lines.map((line) => line.height));
  return {
    lines: [...lines],
    text: lines
      .map((line) => line.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim(),
    height,
    left: Math.min(...lines.map((line) => line.left)),
    right: Math.max(...lines.map((line) => line.right)),
    // A heading is set noticeably larger than the page's usual text and is
    // short enough to be a title rather than a paragraph in a larger face.
    heading: height > bodyHeight * 1.25 && lines.length <= 3,
  };
}

/**
 * Where the columns of a page are, if it has any.
 *
 * Lines that break into the same number of pieces, at the same places across
 * the page, are the shape a table has. Anything less regular is not reported
 * as one: a wrong table is worse than no table.
 */
export interface TableShape {
  /** The left edge of each column, in PDF units. */
  columns: number[];
  /** The lines that fit the shape, top to bottom. */
  rows: TextLine[];
}

export function detectTable(lines: readonly TextLine[]): TableShape | null {
  const candidates = lines.filter((line) => line.items.length >= 2);
  if (candidates.length < 3) return null;

  // Every column edge every line offers, rounded so that near-misses agree.
  const edges = new Map<number, number>();
  for (const line of candidates) {
    for (const start of columnStarts(line)) {
      const key = Math.round(start / 4) * 4;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }

  // A column is an edge most of the candidate lines share.
  const needed = Math.max(2, Math.ceil(candidates.length * 0.6));
  const columns = [...edges.entries()]
    .filter(([, count]) => count >= needed)
    .map(([edge]) => edge)
    .sort((left, right) => left - right);

  if (columns.length < 2) return null;

  const rows = candidates.filter((line) => columnStarts(line).length >= 2);
  return rows.length < 3 ? null : { columns, rows };
}

/** Where each cell of a line starts: after a gap wide enough to be a column. */
function columnStarts(line: TextLine): number[] {
  const starts: number[] = [];
  let previous: ExportTextItem | undefined;

  for (const item of line.items) {
    if (previous === undefined) {
      starts.push(item.x);
    } else {
      const gap = item.x - (previous.x + previous.width);
      if (gap > Math.max(6, line.height * 0.9)) starts.push(item.x);
    }
    previous = item;
  }
  return starts;
}

/** The cells of a line, split at the column edges of the shape. */
export function cellsOf(line: TextLine, columns: readonly number[]): string[] {
  const cells = columns.map(() => '');

  for (const item of line.items) {
    // The column an item belongs to is the last one that begins at or before
    // it, allowing for a little slack either way.
    let index = 0;
    for (const [candidate, edge] of columns.entries()) {
      if (item.x + 4 >= edge) index = candidate;
    }
    const existing = cells[index] ?? '';
    cells[index] = existing === '' ? item.text.trim() : `${existing} ${item.text.trim()}`;
  }

  return cells.map((cell) => cell.replace(/\s+/g, ' ').trim());
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

/** The words of a page as a reader reads them: one line of the page a line. */
export function pageText(lines: readonly TextLine[]): string {
  return lines
    .map((line) => line.text)
    .join('\n')
    .trim();
}

/**
 * The words of a page with the spacing it has.
 *
 * Each line is indented to where it sits, measured in characters of the width
 * the text is set at, so a column of figures stays a column in a text file.
 */
export function pageTextPreservingLayout(lines: readonly TextLine[]): string {
  const width = median(lines.map((line) => line.height)) * 0.5;
  if (width <= 0) return pageText(lines);

  const out: string[] = [];
  let previous: TextLine | undefined;

  for (const line of lines) {
    if (previous !== undefined) {
      // Blank lines where the page has vertical space, so the shape survives.
      const gap = previous.y - line.y;
      const spacing = Math.max(previous.height, line.height);
      const blanks = Math.min(4, Math.max(0, Math.round(gap / spacing) - 1));
      for (let index = 0; index < blanks; index += 1) out.push('');
    }

    let text = '';
    for (const item of line.items) {
      const column = Math.max(0, Math.round(item.x / width));
      if (column > text.length) text = text.padEnd(column, ' ');
      else if (text !== '' && !text.endsWith(' ')) text += ' ';
      text += item.text.trim();
    }
    out.push(text.trimEnd());
    previous = line;
  }

  return out.join('\n').trim();
}
