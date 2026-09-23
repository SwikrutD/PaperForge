import type { PageSetup, PageSize, PaperPreset } from '@shared/schemas/create';

/**
 * Paper, in PDF points.
 *
 * A PDF has no notion of paper: a page is a rectangle in user space, 72 units
 * to the inch. These are the rectangles the named papers correspond to, in
 * portrait, rounded the way every PDF tool rounds them.
 */

export interface Size {
  width: number;
  height: number;
}

const PORTRAIT: Record<PaperPreset, Size> = {
  a3: { width: 841.89, height: 1190.55 },
  a4: { width: 595.28, height: 841.89 },
  a5: { width: 419.53, height: 595.28 },
  letter: { width: 612, height: 792 },
  legal: { width: 612, height: 1008 },
  tabloid: { width: 792, height: 1224 },
};

/** How each paper is named where a reader can see it. */
export const PAPER_LABELS: Record<PaperPreset, string> = {
  a3: 'A3',
  a4: 'A4',
  a5: 'A5',
  letter: 'Letter',
  legal: 'Legal',
  tabloid: 'Tabloid',
};

/** The page rectangle a size describes, or null when it follows its content. */
export function resolveSize(size: PageSize): Size | null {
  if (size.kind === 'image') return null;
  if (size.kind === 'custom') return { width: size.width, height: size.height };

  const portrait = PORTRAIT[size.preset];
  return size.orientation === 'landscape'
    ? { width: portrait.height, height: portrait.width }
    : { ...portrait };
}

/** The rectangle to lay text out in: the page, less its margins. */
export function contentBox(
  page: Size,
  setup: PageSetup,
): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  // A margin wider than half the page would leave nothing to write on.
  const margin = Math.min(setup.margin, page.width / 2 - 24, page.height / 2 - 24);
  const safe = Math.max(0, margin);
  return {
    x: safe,
    y: safe,
    width: Math.max(24, page.width - safe * 2),
    height: Math.max(24, page.height - safe * 2),
  };
}

/** Points, as a reader thinks of them. 72 pt is one inch. */
export function describeSize(size: Size): string {
  const inches = `${(size.width / 72).toFixed(2)} × ${(size.height / 72).toFixed(2)} in`;
  return `${Math.round(size.width)} × ${Math.round(size.height)} pt (${inches})`;
}
