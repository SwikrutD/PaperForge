import { useEffect } from 'react';
import type { PdfPageGeometry } from '@pdf/render/types';
import type { AnnotationRect } from '@shared/schemas/annotation';
import { cssRectToPdf } from '../viewer/pageGeometry';
import { quadsFromRects } from './annotationDrawing';

/** Anything thinner than this is a caret or a stray rectangle, not a word. */
const MIN_RECT = 1.5;

export interface MarkupSelection {
  pageNumber: number;
  quads: number[][];
  /** The same rectangles, in page coordinates, before they became quads. */
  rects: AnnotationRect[];
  /** What was selected, across every page it ran over. */
  text: string;
}

/**
 * Turns the reader's text selection into the quads a markup annotation needs.
 *
 * The browser already knows exactly where the selected glyphs are — the text
 * layer is real DOM — so marking text is a matter of taking those rectangles
 * and putting them back into page coordinates, rather than guessing at word
 * boundaries.
 */
export function useTextMarkup(
  enabled: boolean,
  pages: readonly PdfPageGeometry[],
  scale: number,
  rotation: number,
  onSelection: (selections: MarkupSelection[]) => void,
): void {
  useEffect(() => {
    if (!enabled) return;

    const finish = (): void => {
      const selection = window.getSelection();
      if (selection === null || selection.isCollapsed) return;

      const selections = collectSelections(selection, pages, scale, rotation);
      if (selections.length === 0) return;
      const text = selection.toString().replace(/\s+/g, ' ').trim();
      for (const entry of selections) entry.text = text;

      selection.removeAllRanges();
      onSelection(selections);
    };

    // Pointer up rather than selectionchange: the reader is finished choosing.
    document.addEventListener('pointerup', finish);
    return () => document.removeEventListener('pointerup', finish);
  }, [enabled, pages, scale, rotation, onSelection]);
}

/** The selected rectangles, grouped by the page they fall on. */
function collectSelections(
  selection: Selection,
  pages: readonly PdfPageGeometry[],
  scale: number,
  rotation: number,
): MarkupSelection[] {
  const byPage = new Map<number, AnnotationRect[]>();

  for (let index = 0; index < selection.rangeCount; index += 1) {
    const range = selection.getRangeAt(index);
    for (const clientRect of range.getClientRects()) {
      if (clientRect.width < MIN_RECT || clientRect.height < MIN_RECT) continue;

      const element = pageElementFor(clientRect);
      if (element === null) continue;
      const pageNumber = Number.parseInt(element.dataset['pageNumber'] ?? '', 10);
      const geometry = pages[pageNumber - 1];
      if (geometry === undefined) continue;

      const bounds = element.getBoundingClientRect();
      const rect = cssRectToPdf(
        {
          left: clientRect.left - bounds.left,
          top: clientRect.top - bounds.top,
          width: clientRect.width,
          height: clientRect.height,
        },
        geometry,
        scale,
        rotation,
      );

      byPage.set(pageNumber, [...(byPage.get(pageNumber) ?? []), rect]);
    }
  }

  return [...byPage.entries()]
    .map(([pageNumber, rects]) => ({ pageNumber, quads: quadsFromRects(rects), rects, text: '' }))
    .filter((entry) => entry.quads.length > 0);
}

/** The mounted page a selection rectangle sits on, if any. */
function pageElementFor(rect: DOMRect): HTMLElement | null {
  const centreX = rect.left + rect.width / 2;
  const centreY = rect.top + rect.height / 2;

  for (const element of document.querySelectorAll<HTMLElement>('[data-page-number]')) {
    const bounds = element.getBoundingClientRect();
    if (
      centreX >= bounds.left &&
      centreX <= bounds.right &&
      centreY >= bounds.top &&
      centreY <= bounds.bottom
    ) {
      return element;
    }
  }
  return null;
}
