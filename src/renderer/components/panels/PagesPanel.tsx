import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { LoadedPdfDocument, PdfPageGeometry } from '@pdf/render/types';
import { useDocumentStore } from '../../stores/documentStore';
import { cx } from '../../utils/classNames';
import styles from './PagesPanel.module.css';

const THUMBNAIL_WIDTH = 120;

interface PagesPanelProps {
  document: LoadedPdfDocument;
  sessionId: string;
  currentPage: number;
}

/** Page thumbnails. Clicking one takes the reader there. */
export function PagesPanel({ document, sessionId, currentPage }: PagesPanelProps): ReactElement {
  const updateView = useDocumentStore((state) => state.updateView);
  const listRef = useRef<HTMLUListElement>(null);

  // Keep the current page in sight as the reader scrolls the document.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-thumbnail-page="${currentPage}"]`)
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [currentPage]);

  return (
    <ul className={styles.list} ref={listRef}>
      {document.pages.map((page) => (
        <li key={page.pageNumber} data-thumbnail-page={page.pageNumber}>
          <button
            type="button"
            className={cx(styles.item, page.pageNumber === currentPage && styles.current)}
            aria-current={page.pageNumber === currentPage ? 'true' : undefined}
            onClick={() => updateView(sessionId, { pendingPage: page.pageNumber })}
          >
            <Thumbnail document={document} page={page} />
            <span className={styles.label}>{page.label ?? page.pageNumber}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * One thumbnail, rendered only once it comes into view and released when it
 * leaves — a long document must not hold a thousand canvases.
 */
function Thumbnail({
  document: pdf,
  page,
}: {
  document: LoadedPdfDocument;
  page: PdfPageGeometry;
}): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);

  const aspect = page.height === 0 ? 1.4 : page.height / page.width;
  const height = Math.round(THUMBNAIL_WIDTH * aspect);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const observer = new IntersectionObserver(
      (entries) => setVisible(entries.some((entry) => entry.isIntersecting)),
      { rootMargin: '200px' },
    );
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || !visible) return;

    const controller = new AbortController();
    void pdf
      .renderPage({
        pageNumber: page.pageNumber,
        scale: THUMBNAIL_WIDTH / page.width,
        rotation: 0,
        canvas,
        devicePixelRatio: window.devicePixelRatio || 1,
        signal: controller.signal,
      })
      .catch(() => undefined);

    return () => controller.abort();
  }, [pdf, page.pageNumber, page.width, visible]);

  return (
    <span className={styles.frame} style={{ width: `${THUMBNAIL_WIDTH}px`, height: `${height}px` }}>
      <canvas className={styles.canvas} ref={canvasRef} />
    </span>
  );
}
