/**
 * Checking a PDF's index of its own objects.
 *
 * Every PDF ends by saying where its cross-reference table is, and the table
 * says at which byte each object starts. A file that has been edited
 * carelessly, truncated or joined to something else usually still opens —
 * readers rebuild the table by scanning — but the table itself is wrong, and
 * that is worth saying before the reader relies on the file. This reads the
 * table and looks at each offset; it does not decode anything.
 */

export interface IndexCheck {
  /** True when every entry that could be checked pointed at its object. */
  ok: boolean;
  /** What was wrong, in words, most important first. */
  problems: string[];
  /** Object offsets looked at. */
  checked: number;
}

/** Sections followed through `/Prev`, which is plenty for any honest file. */
const MAX_SECTIONS = 64;
/** Beyond this the file is not read into a string just to check its index. */
const MAX_CHECKED_BYTES = 256 * 1024 * 1024;
/** Mismatched entries described one by one before they are summarised. */
const MAX_LISTED = 5;

/** The check, or null for a file too large to be worth reading this way. */
export function checkCrossReference(bytes: Uint8Array): IndexCheck | null {
  if (bytes.length > MAX_CHECKED_BYTES) return null;
  const text = latin1(bytes);
  const problems: string[] = [];

  const start = lastStartXref(text);
  if (start === null) {
    return {
      ok: false,
      problems: ['The file does not say where its index of objects is.'],
      checked: 0,
    };
  }

  let offset: number | null = start;
  let checked = 0;
  const mismatched: number[] = [];
  const seen = new Set<number>();

  for (let section = 0; offset !== null && section < MAX_SECTIONS; section += 1) {
    if (seen.has(offset)) {
      problems.push('The index refers back to itself.');
      break;
    }
    seen.add(offset);

    if (offset < 0 || offset >= text.length) {
      problems.push('The index is said to be beyond the end of the file.');
      break;
    }

    if (/^\s*xref\b/.test(text.slice(offset, offset + 16))) {
      const table = readTable(text, offset);
      if (table === null) {
        problems.push('The index of objects could not be read.');
        break;
      }
      for (const [objectNumber, at] of table.entries) {
        checked += 1;
        if (!objectStartsAt(text, at, objectNumber)) mismatched.push(objectNumber);
      }
      offset = table.previous;
      continue;
    }

    // A compressed index is itself an object; this checks it is where the
    // file says, and leaves its contents to the engines that decode streams.
    if (/^\s*\d+\s+\d+\s+obj\b/.test(text.slice(offset, offset + 32))) {
      checked += 1;
      const previous = /\/Prev\s+(\d+)/.exec(text.slice(offset, offset + 4096));
      offset = previous === null ? null : Number(previous[1]);
      continue;
    }

    problems.push('The file says its index of objects is somewhere it is not.');
    break;
  }

  if (mismatched.length > 0) {
    const listed = mismatched.slice(0, MAX_LISTED).join(', ');
    const more =
      mismatched.length > MAX_LISTED ? ` and ${String(mismatched.length - MAX_LISTED)} more` : '';
    problems.unshift(
      `${String(mismatched.length)} of ${String(checked)} objects are not where the index says (object ${listed}${more}).`,
    );
  }

  return { ok: problems.length === 0, problems, checked };
}

function lastStartXref(text: string): number | null {
  const tail = text.slice(Math.max(0, text.length - 2048));
  const matches = [...tail.matchAll(/startxref\s+(\d+)/g)];
  const last = matches[matches.length - 1];
  return last === undefined ? null : Number(last[1]);
}

interface Table {
  entries: Array<[number, number]>;
  previous: number | null;
}

/** A classic `xref` table: subsections of twenty-byte entries, then a trailer. */
function readTable(text: string, offset: number): Table | null {
  const pattern = /\s*xref\s*/y;
  pattern.lastIndex = offset;
  if (pattern.exec(text) === null) return null;
  let position = pattern.lastIndex;
  const entries: Array<[number, number]> = [];

  const header = /(\d+)\s+(\d+)\s*/y;
  const entry = /(\d{10})\s(\d{5})\s([nf])\s*/y;

  for (;;) {
    header.lastIndex = position;
    const subsection = header.exec(text);
    if (subsection === null) break;
    const first = Number(subsection[1]);
    const count = Number(subsection[2]);
    position = header.lastIndex;

    for (let index = 0; index < count; index += 1) {
      entry.lastIndex = position;
      const row = entry.exec(text);
      if (row === null) return null;
      position = entry.lastIndex;
      if (row[3] === 'n') entries.push([first + index, Number(row[1])]);
    }
  }

  if (!text.startsWith('trailer', position)) return null;
  const trailer = text.slice(position, position + 4096);
  const previous = /\/Prev\s+(\d+)/.exec(trailer);
  return { entries, previous: previous === null ? null : Number(previous[1]) };
}

function objectStartsAt(text: string, offset: number, objectNumber: number): boolean {
  if (offset < 0 || offset >= text.length) return false;
  const match = /^\s*(\d+)\s+\d+\s+obj\b/.exec(text.slice(offset, offset + 40));
  return match !== null && Number(match[1]) === objectNumber;
}

/** One character per byte, which is what every offset in a PDF counts. */
function latin1(bytes: Uint8Array): string {
  let text = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    text += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return text;
}
