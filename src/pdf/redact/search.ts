import type { PDFDocument } from 'pdf-lib';
import {
  MAX_REDACTION_MATCHES,
  type RedactionMatch,
  type RedactionSearch,
  type RedactionSearchResult,
} from '@shared/schemas/redaction';
import { readPageContent } from '../content/pageContent';
import { applyMatrix, matrixScale } from '../content/state';
import type { TextRun } from '../content/textRuns';
import { union, type Rect } from './geometry';
import { glyphBoxes, type GlyphBox } from './text';

/**
 * Finding text to mark.
 *
 * The search runs over the same glyphs redaction removes, read from the
 * page's own drawing, so a match marks exactly the glyphs that will go — not
 * an estimate of where the words are. Words drawn as separate runs, or spaced
 * by positioning rather than by a space character, are joined the way a
 * reader sees them.
 */

interface Character {
  character: string;
  /** Null for a space PaperForge inferred from the gap between glyphs. */
  box: GlyphBox | null;
  /** Which run the glyph belongs to, for grouping a match into boxes. */
  run: number;
}

/** A gap wider than this share of the text size reads as a space. */
const SPACE_GAP = 0.15;
/** A shift off the line wider than this share of the text size is a new line. */
const LINE_SHIFT = 0.5;

export async function findForRedaction(
  document: PDFDocument,
  search: RedactionSearch,
): Promise<Omit<RedactionSearchResult, 'revision'>> {
  const query = normalize(search.query.trim());
  const matches: RedactionMatch[] = [];
  const unreadablePages: number[] = [];
  const textlessPages: number[] = [];

  for (let pageIndex = 0; pageIndex < document.getPageCount(); pageIndex += 1) {
    const content = await readPageContent(document, pageIndex);
    const runs = content.runs.filter((run) => run.glyphs.length > 0);
    if (runs.length === 0) {
      textlessPages.push(pageIndex + 1);
      continue;
    }
    const characters = charactersOf(runs);
    if (characters.some((entry) => entry.character === '�')) unreadablePages.push(pageIndex + 1);
    if (query === '' || matches.length >= MAX_REDACTION_MATCHES) continue;

    for (const [start, end] of occurrences(characters, query, search)) {
      const found = characters.slice(start, end);
      const rects = rectsOf(found);
      if (rects.length === 0) continue;
      matches.push({
        page: pageIndex + 1,
        rects,
        text: found.map((entry) => entry.character).join(''),
      });
      if (matches.length >= MAX_REDACTION_MATCHES) break;
    }
  }

  return { matches, unreadablePages, textlessPages };
}

/** The page's text as a reader sees it, one entry per character. */
function charactersOf(runs: readonly TextRun[]): Character[] {
  const characters: Character[] = [];
  let previousEnd: { x: number; y: number } | null = null;

  runs.forEach((run, runIndex) => {
    const boxes = glyphBoxes(run);
    const size = Math.abs(run.fontSize) * matrixScale(run.matrix).y || 1;
    const scale = matrixScale(run.matrix).x || 1;
    const direction = { x: run.matrix.a / scale, y: run.matrix.b / scale };

    run.glyphs.forEach((glyph, glyphIndex) => {
      const start = applyMatrix(run.matrix, glyph.offset, 0);
      if (previousEnd !== null) {
        const dx = start.x - previousEnd.x;
        const dy = start.y - previousEnd.y;
        const along = dx * direction.x + dy * direction.y;
        const across = Math.abs(-dx * direction.y + dy * direction.x);
        if (across > size * LINE_SHIFT || along > size * SPACE_GAP || along < -size) {
          pushSpace(characters, runIndex);
        }
      }
      previousEnd = applyMatrix(run.matrix, glyph.offset + glyph.advance, 0);

      const box = boxes[glyphIndex] ?? null;
      const text = glyph.text ?? '�';
      for (const character of text) {
        if (/\s/.test(character)) pushSpace(characters, runIndex, box);
        else characters.push({ character, box, run: runIndex });
      }
    });
  });
  return characters;
}

/** One space, however many the page draws or implies in a row. */
function pushSpace(characters: Character[], run: number, box: GlyphBox | null = null): void {
  const last = characters[characters.length - 1];
  if (last === undefined || last.character === ' ') return;
  characters.push({ character: ' ', box, run });
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ');
}

/** Where the query occurs, as [start, end) indices into the characters. */
function occurrences(
  characters: readonly Character[],
  query: string,
  search: RedactionSearch,
): Array<[number, number]> {
  const fold = (value: string): string => {
    if (search.matchCase) return value;
    const lower = value.toLowerCase();
    // Folding must not change how many characters there are, or the match
    // would point at the wrong glyphs.
    return lower.length === value.length ? lower : value;
  };
  const haystack = characters.map((entry) => fold(entry.character));
  const needle = [...query].map(fold);
  const found: Array<[number, number]> = [];

  for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    let matched = true;
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[start + offset] !== needle[offset]) {
        matched = false;
        break;
      }
    }
    if (!matched) continue;
    const end = start + needle.length;
    if (
      search.wholeWord &&
      (isWordCharacter(haystack[start - 1]) || isWordCharacter(haystack[end]))
    ) {
      continue;
    }
    found.push([start, end]);
    start = end - 1;
  }
  return found;
}

function isWordCharacter(character: string | undefined): boolean {
  return character !== undefined && /[\p{L}\p{N}_]/u.test(character);
}

/**
 * The boxes a match covers: one per run, then joined along a line, so a
 * phrase drawn word by word is marked as one bar rather than a dozen.
 */
function rectsOf(found: readonly Character[]): Rect[] {
  const perRun: Rect[] = [];
  let current: { run: number; rect: Rect } | null = null;
  for (const entry of found) {
    if (entry.box === null) continue;
    if (current !== null && current.run === entry.run) {
      current.rect = union(current.rect, entry.box.bounds);
      continue;
    }
    if (current !== null) perRun.push(current.rect);
    current = { run: entry.run, rect: entry.box.bounds };
  }
  if (current !== null) perRun.push(current.rect);

  const merged: Rect[] = [];
  for (const rect of perRun) {
    const last = merged[merged.length - 1];
    if (last !== undefined && sameLine(last, rect)) merged[merged.length - 1] = union(last, rect);
    else merged.push(rect);
  }
  return merged.filter((rect) => rect.width > 0 && rect.height > 0);
}

function sameLine(first: Rect, second: Rect): boolean {
  const shared =
    Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y);
  const height = Math.min(first.height, second.height);
  const gap = Math.max(second.x - (first.x + first.width), first.x - (second.x + second.width));
  return shared >= height * 0.5 && gap <= Math.max(first.height, second.height);
}
