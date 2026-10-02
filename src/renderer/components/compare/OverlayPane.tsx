import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { Difference } from '@pdf/compare/model';
import { useCompareStore } from '../../stores/compareStore';
import { cx } from '../../utils/classNames';
import { cssBoxStyle, pdfRectToCss } from '../viewer/pageGeometry';
import { useCompareDocument } from './useCompareDocument';
import styles from './compare.module.css';

/**
 * Both pages of a pair in one picture: what is the same is faint, and what
 * differs is coloured by which document has it. The worker paints it; the
 * differences are outlined over it as they are on the side-by-side view.
 */
export function OverlayPane({
  pair,
  originalPage,
  revisedPage,
  differences,
}: {
  pair: number;
  originalPage: number | null;
  revisedPage: number | null;
  differences: readonly Difference[];
}): ReactElement {
  const overlay = useCompareStore((state) => state.overlay);
  const selectedId = useCompareStore((state) => state.selectedId);
  const original = useCompareDocument('original');
  const revised = useCompareDocument('revised');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [shownWidth, setShownWidth] = useState(0);

  useEffect(() => {
    void useCompareStore.getState().loadOverlay(pair);
  }, [pair]);

  const ready = overlay !== null && overlay.pair === pair;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!ready || canvas === null) return;
    canvas.width = overlay.width;
    canvas.height = overlay.height;
    const pixels = new Uint8ClampedArray(overlay.pixels);
    canvas
      .getContext('2d')
      ?.putImageData(new ImageData(pixels, overlay.width, overlay.height), 0, 0);
  }, [ready, overlay]);

  useEffect(() => {
    const element = frameRef.current;
    if (element === null) return;
    const observer = new ResizeObserver(() => setShownWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ready]);

  const revisedGeometry = revisedPage === null ? undefined : revised?.pages[revisedPage - 1];
  const originalGeometry = originalPage === null ? undefined : original?.pages[originalPage - 1];
  const factor = ready && overlay.width > 0 ? shownWidth / overlay.width : 0;

  return (
    <section className={styles.overlayPane} aria-label="Differences overlaid">
      <p className={styles.legend}>
        <span className={cx(styles.swatch, styles.swatchRemoved)} aria-hidden="true" /> Only in the
        original
        <span className={cx(styles.swatch, styles.swatchAdded)} aria-hidden="true" /> Only in the
        revision
        <span className={cx(styles.swatch, styles.swatchChanged)} aria-hidden="true" /> Changed in
        both
      </p>
      {originalPage === null || revisedPage === null ? (
        <p className={styles.noPage}>
          Only one document has a page here; there is nothing to overlay.
        </p>
      ) : !ready ? (
        <p className={styles.noPage}>Drawing the difference…</p>
      ) : (
        <div className={styles.overlayFrame} ref={frameRef} data-compare-overlay="">
          <canvas ref={canvasRef} className={styles.overlayCanvas} />
          {factor > 0 &&
            differences.flatMap((difference) => {
              // Both pages share the picture's top-left corner, so a mark is
              // placed from whichever page has it: removed text only the
              // original has.
              const onRevised = difference.revisedRects.length > 0;
              const geometry = onRevised ? revisedGeometry : originalGeometry;
              const rects = onRevised ? difference.revisedRects : difference.originalRects;
              if (geometry === undefined) return [];
              return rects.map((rect, index) => {
                const box = pdfRectToCss(rect, geometry, overlay.scale * factor, 0);
                if (box === null) return null;
                return (
                  <span
                    key={`${difference.id}:${String(index)}`}
                    className={cx(
                      styles.mark,
                      styles[difference.kind],
                      difference.id === selectedId && styles.markSelected,
                    )}
                    style={cssBoxStyle(box)}
                    title={difference.summary}
                  />
                );
              });
            })}
        </div>
      )}
    </section>
  );
}
