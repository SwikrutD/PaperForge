import { spliceBytes } from './editText';
import { parseContent } from './parser';
import { nameOf } from './values';

/**
 * Page furniture: the watermarks, backgrounds, headers and footers PaperForge
 * puts on a page rather than the document's own drawing.
 *
 * Each one is wrapped in marked content named after what it is —
 * `/PFWatermark BDC … EMC` — so that PaperForge can find its own work again
 * and take it off or put a new one in its place. Nothing else on the page is
 * touched, and a document that carries no PaperForge furniture is left
 * exactly as it was.
 */

export const FURNITURE_KINDS = ['watermark', 'background', 'header', 'footer'] as const;
export type FurnitureKind = (typeof FURNITURE_KINDS)[number];

const TAGS: Record<FurnitureKind, string> = {
  watermark: 'PFWatermark',
  background: 'PFBackground',
  header: 'PFHeader',
  footer: 'PFFooter',
};

export function tagFor(kind: FurnitureKind): string {
  return TAGS[kind];
}

/** Wraps drawing operators as a named, findable block. */
export function furnitureBlock(kind: FurnitureKind, body: string): string {
  return `/${TAGS[kind]} BDC\nq\n${body.trim()}\nQ\nEMC\n`;
}

/** Puts a block after everything the page draws, so it goes on top. */
export function appendFurniture(content: Uint8Array, block: string): Uint8Array {
  return spliceBytes(content, { start: content.length, end: content.length }, `\n${block}`);
}

/**
 * Puts a block before everything the page draws, so it goes underneath.
 *
 * The page's own drawing is wrapped in `q`/`Q` as it is moved along, so that
 * nothing the block sets can leak into it.
 */
export function prependFurniture(content: Uint8Array, block: string): Uint8Array {
  const wrapped = spliceBytes(content, { start: 0, end: 0 }, `${block}q\n`);
  return spliceBytes(wrapped, { start: wrapped.length, end: wrapped.length }, '\nQ\n');
}

/**
 * Takes PaperForge's own furniture off a page.
 *
 * Only the blocks named here go; a block inside another block goes with the
 * one that contains it, and everything else stays exactly where it is.
 */
export function removeFurniture(
  content: Uint8Array,
  kinds: readonly FurnitureKind[],
): { bytes: Uint8Array; removed: number } {
  const wanted = new Set(kinds.map((kind) => TAGS[kind]));
  const operations = parseContent(content);
  const ranges: { start: number; end: number }[] = [];

  let depth = 0;
  let start: number | null = null;

  for (const operation of operations) {
    if (operation.operator === 'BDC' || operation.operator === 'BMC') {
      if (start !== null) {
        depth += 1;
        continue;
      }
      const tag = nameOf(operation.operands[0]);
      if (tag !== null && wanted.has(tag)) start = operation.range.start;
      continue;
    }

    if (operation.operator === 'EMC' && start !== null) {
      if (depth > 0) {
        depth -= 1;
        continue;
      }
      ranges.push({ start, end: operation.range.end });
      start = null;
    }
  }

  // Back to front, so that a range's offsets are still true when it is cut.
  let bytes = content;
  for (const range of [...ranges].reverse()) bytes = spliceBytes(bytes, range, '');
  return { bytes, removed: ranges.length };
}

/** Which of PaperForge's furniture a page already carries. */
export function furnitureOn(content: Uint8Array): FurnitureKind[] {
  const present = new Set<FurnitureKind>();
  for (const operation of parseContent(content)) {
    if (operation.operator !== 'BDC' && operation.operator !== 'BMC') continue;
    const tag = nameOf(operation.operands[0]);
    for (const kind of FURNITURE_KINDS) {
      if (tag === TAGS[kind]) present.add(kind);
    }
  }
  return [...present];
}
