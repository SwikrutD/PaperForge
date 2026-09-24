import type { TextFamily } from '@shared/schemas/text';

/** Colours as a picker takes them, and as a PDF wants them. */

export function hexOf(color: { r: number; g: number; b: number }): string {
  return `#${[color.r, color.g, color.b]
    .map((part) =>
      Math.round(part * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

export function rgbOf(hex: string): { r: number; g: number; b: number } {
  const value = hex.replace('#', '');
  const channel = (index: number): number =>
    Number.parseInt(value.slice(index * 2, index * 2 + 2), 16) / 255;
  return { r: channel(0), g: channel(1), b: channel(2) };
}

/** The nearest font on this machine to the one the page will be drawn with. */
export function cssFamily(family: TextFamily): string {
  if (family === 'times') return 'Georgia, "Times New Roman", serif';
  if (family === 'courier') return 'Consolas, "Courier New", monospace';
  return 'Segoe UI, Arial, sans-serif';
}
