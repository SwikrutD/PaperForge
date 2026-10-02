import { useCallback } from 'react';
import type { PdfPageGeometry } from '@pdf/render/types';
import { useRedactionStore } from '../../stores/redactionStore';
import { useTextMarkup, type MarkupSelection } from '../annotations/useTextMarkup';

/** Anything thinner than this, in PDF units, is a caret rather than text. */
const SMALLEST = 0.5;

/**
 * Marks selected text for redaction while the text tool is on.
 *
 * The rectangles are the browser's own selection boxes over the text layer,
 * the same ones a highlight is made from. They need not fit the glyphs
 * exactly: when the marks are applied, a glyph goes if its middle or most of
 * it lies under a mark, and the review lists exactly which text that is.
 */
export function useRedactionMarking(
  sessionId: string,
  pages: readonly PdfPageGeometry[],
  scale: number,
  rotation: number,
): void {
  const enabled = useRedactionStore((state) => state.active && state.tool === 'text');

  const onSelection = useCallback(
    (selections: MarkupSelection[]) => {
      const store = useRedactionStore.getState();
      for (const selection of selections) {
        const rects = selection.rects.filter(
          (rect) => rect.width > SMALLEST && rect.height > SMALLEST,
        );
        if (rects.length === 0) continue;
        store.addMark(sessionId, {
          page: selection.pageNumber,
          rects,
          source: 'text',
          label: selection.text === '' ? 'Selected text' : selection.text.slice(0, 200),
        });
      }
    },
    [sessionId],
  );

  useTextMarkup(enabled, pages, scale, rotation, onSelection);
}
