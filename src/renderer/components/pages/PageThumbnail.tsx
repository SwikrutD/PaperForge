import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { LoadedPdfDocument, PdfPageGeometry } from '@pdf/render/types';
import styles from './PageThumbnail.module.css';

interface PageThumbnailProps {
  document: LoadedPdfDocument;
  page: PdfPageGeometry;
  /** Width in CSS pixels; the height follows the page's proportions. */
  width: number;
  /** Bumped to force a repaint after the page itself has changed. */
  version?: number;
}

/**
 * One page, drawn small.
 *
 * It renders only once it comes into view and is released when it leaves, so a
 * long document costs the same as a short one whether it is shown in the
 * navigation panel or in the page grid.
 */
export function PageThumbnail({
  document: pdf,
  page,
  width,
  version = 0,
}: PageThumbnailProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);

  const aspect = page.width === 0 ? 1.4 : page.height / page.width;
  const height = Math.round(width * aspect);

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
        scale: width / page.width,
        rotation: 0,
        canvas,
        devicePixelRatio: window.devicePixelRatio || 1,
        signal: controller.signal,
      })
      .catch(() => undefined);

    return () => controller.abort();
  }, [pdf, page.pageNumber, page.width, width, visible, version]);

  // Out of view, the pixels go: a canvas otherwise keeps them for as long as
  // it exists, and a long document's panel would hold every page it passed.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || visible) return;
    canvas.width = 0;
    canvas.height = 0;
  }, [visible]);

  return (
    <span className={styles.frame} style={{ width: `${width}px`, height: `${height}px` }}>
      {/* Empty until drawn: an unsized canvas would still be 300 by 150. */}
      <canvas className={styles.canvas} ref={canvasRef} width={0} height={0} />
    </span>
  );
}
