import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type UIEventHandler,
} from 'react';
import type { Difference, Rect } from '@pdf/compare/model';
import { useCompareStore, type CompareSide } from '../../stores/compareStore';
import { cx } from '../../utils/classNames';
import { cssBoxStyle, pdfRectToCss } from '../viewer/pageGeometry';
import { useCompareDocument } from './useCompareDocument';
import styles from './compare.module.css';

interface ComparePaneProps {
  side: CompareSide;
  pageNumber: number | null;
  differences: readonly Difference[];
  onScroll?: UIEventHandler<HTMLDivElement>;
}

const LABELS: Record<CompareSide, string> = { original: 'Original', revised: 'Revised' };

/** Room left around the page inside the pane. */
const GUTTER = 32;

/**
 * One side of a page pair, fitted to the pane's width, with the differences
 * on it outlined. Removed text is marked on the original, added text on the
 * revision, and changes and pictures on both.
 */
export const ComparePane = forwardRef<HTMLDivElement, ComparePaneProps>(function ComparePane(
  { side, pageNumber, differences, onScroll },
  scrollerRef,
): ReactElement {
  const document = useCompareDocument(side);
  const selectedId = useCompareStore((state) => state.selectedId);
  const focusNonce = useCompareStore((state) => state.focusNonce);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = measureRef.current;
    if (element === null) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);

  const geometry = pageNumber === null ? undefined : document?.pages[pageNumber - 1];
  const pageWidth =
    geometry === undefined || document === null
      ? 0
      : document.pageSize(geometry.pageNumber, 1, 0).width;
  const scale = pageWidth > 0 && width > GUTTER ? (width - GUTTER) / pageWidth : 0;
  const size =
    geometry === undefined || document === null || scale === 0
      ? null
      : document.pageSize(geometry.pageNumber, scale, 0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (document === null || pageNumber === null || canvas === null || scale === 0) return;
    const controller = new AbortController();
    void document
      .renderPage({
        pageNumber,
        scale,
        rotation: 0,
        canvas,
        devicePixelRatio: window.devicePixelRatio || 1,
        signal: controller.signal,
      })
      .catch(() => {
        // A render overtaken by the next one is not a failure.
      });
    return () => controller.abort();
  }, [document, pageNumber, scale]);

  const rectsOf = (difference: Difference): Rect[] =>
    side === 'original' ? difference.originalRects : difference.revisedRects;

  // Bring the chosen difference into view when the list asks for it.
  useEffect(() => {
    const scroller = typeof scrollerRef === 'function' ? null : scrollerRef?.current;
    if (scroller === null || scroller === undefined || geometry === undefined || scale === 0)
      return;
    const selected = differences.find((difference) => difference.id === selectedId);
    const rect = selected === undefined ? undefined : rectsOf(selected)[0];
    if (rect === undefined) return;
    const box = pdfRectToCss(rect, geometry, scale, 0);
    if (box === null) return;
    scroller.scrollTo({
      top: Math.max(0, box.top - scroller.clientHeight / 3),
      behavior: 'smooth',
    });
    // Only a new request moves the view; zooming the pane does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce]);

  return (
    <section className={styles.pane} aria-label={`${LABELS[side]} page`}>
      <header className={styles.paneHeader}>
        <span className={styles.paneLabel}>{LABELS[side]}</span>
        <span className={styles.paneMeta}>
          {pageNumber === null ? 'No page here' : `Page ${String(pageNumber)}`}
        </span>
      </header>
      <div className={styles.paneScroller} ref={scrollerRef} onScroll={onScroll} tabIndex={0}>
        <div ref={measureRef} className={styles.measure} />
        {pageNumber === null ? (
          <p className={styles.noPage}>
            {side === 'original'
              ? 'The revised document has a page here that the original does not.'
              : 'The original document has a page here that the revision does not.'}
          </p>
        ) : (
          <div
            className={styles.page}
            data-compare-page={side}
            style={
              size === null ? undefined : { width: `${size.width}px`, height: `${size.height}px` }
            }
          >
            <canvas ref={canvasRef} className={styles.canvas} />
            {geometry !== undefined &&
              scale > 0 &&
              differences.flatMap((difference) =>
                rectsOf(difference).map((rect, index) => {
                  const box = pdfRectToCss(rect, geometry, scale, 0);
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
                      data-difference={difference.kind}
                    />
                  );
                }),
              )}
          </div>
        )}
      </div>
    </section>
  );
});
