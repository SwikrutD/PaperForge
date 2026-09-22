import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { LoadedPdfDocument, PdfLink } from '@pdf/render/types';
import type { PageBox } from './viewerLayout';
import styles from './PdfPageView.module.css';

interface PdfPageViewProps {
  document: LoadedPdfDocument;
  box: PageBox;
  scale: number;
  rotation: number;
  label: string | null;
  /** Bumped when layer visibility changes, which requires a repaint. */
  layersVersion: number;
  onFollowLink: (link: PdfLink) => void;
}

/**
 * One page: the rendered canvas, a selectable text layer on top of it, and
 * link hotspots. Rendering is cancelled when the page scrolls out of view or
 * the zoom changes, so a fast scroll never queues work nobody will see.
 */
export function PdfPageView({
  document: pdf,
  box,
  scale,
  rotation,
  label,
  layersVersion,
  onFollowLink,
}: PdfPageViewProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [links, setLinks] = useState<PdfLink[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const canvas = canvasRef.current;
    const textLayer = textRef.current;
    if (canvas === null || textLayer === null) return;

    setFailed(false);
    const render = async (): Promise<void> => {
      await pdf.renderPage({
        pageNumber: box.pageNumber,
        scale,
        rotation,
        canvas,
        devicePixelRatio: window.devicePixelRatio || 1,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      await pdf.renderTextLayer({
        pageNumber: box.pageNumber,
        scale,
        rotation,
        container: textLayer,
        signal: controller.signal,
      });
    };

    void render().catch(() => {
      if (!controller.signal.aborted) setFailed(true);
    });

    return () => controller.abort();
  }, [pdf, box.pageNumber, scale, rotation, layersVersion]);

  useEffect(() => {
    let cancelled = false;
    void pdf
      .getLinks(box.pageNumber)
      .then((result) => {
        if (!cancelled) setLinks(result);
      })
      .catch(() => {
        if (!cancelled) setLinks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [pdf, box.pageNumber]);

  return (
    <div
      className={styles.page}
      style={{ top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` }}
      data-page-number={box.pageNumber}
      aria-label={`Page ${label ?? String(box.pageNumber)}`}
    >
      <canvas className={styles.canvas} ref={canvasRef} />
      <div className={styles.textLayer} ref={textRef} />

      {links.map((link) => {
        const position = linkPosition(link, scale, rotation, pdf, box.pageNumber);
        if (position === null) return null;
        return (
          <button
            key={link.id}
            type="button"
            className={styles.link}
            style={position}
            title={linkTitle(link)}
            aria-label={linkTitle(link)}
            onClick={() => onFollowLink(link)}
          />
        );
      })}

      {failed && (
        <div className={styles.failed} role="status">
          This page could not be rendered.
        </div>
      )}
      <span className={styles.badge} aria-hidden="true">
        {label ?? box.pageNumber}
      </span>
    </div>
  );
}

function linkTitle(link: PdfLink): string {
  if (link.target.kind === 'url') return link.title ?? link.target.url;
  if (link.target.kind === 'page') return link.title ?? `Go to page ${link.target.pageNumber}`;
  return link.title ?? 'Link';
}

/**
 * PDF rectangles are in user space with the origin at the bottom left, so they
 * are converted to CSS pixels from the top left of the rendered page.
 */
function linkPosition(
  link: PdfLink,
  scale: number,
  rotation: number,
  pdf: LoadedPdfDocument,
  pageNumber: number,
): { left: string; top: string; width: string; height: string } | null {
  const geometry = pdf.pages[pageNumber - 1];
  if (geometry === undefined) return null;

  const [x1, y1, x2, y2] = link.rect;
  const left = Math.min(x1, x2);
  const right = Math.max(x1, x2);
  const bottom = Math.min(y1, y2);
  const top = Math.max(y1, y2);

  const turns = (((geometry.rotation + rotation) % 360) + 360) % 360;
  const pageWidth = geometry.width;
  const pageHeight = geometry.height;

  let cssLeft: number;
  let cssTop: number;
  let cssWidth: number;
  let cssHeight: number;

  if (turns === 90) {
    cssLeft = pageHeight - top;
    cssTop = left;
    cssWidth = top - bottom;
    cssHeight = right - left;
  } else if (turns === 180) {
    cssLeft = pageWidth - right;
    cssTop = bottom;
    cssWidth = right - left;
    cssHeight = top - bottom;
  } else if (turns === 270) {
    cssLeft = bottom;
    cssTop = pageWidth - right;
    cssWidth = top - bottom;
    cssHeight = right - left;
  } else {
    cssLeft = left;
    cssTop = pageHeight - top;
    cssWidth = right - left;
    cssHeight = top - bottom;
  }

  if (cssWidth <= 0 || cssHeight <= 0) return null;
  return {
    left: `${cssLeft * scale}px`,
    top: `${cssTop * scale}px`,
    width: `${cssWidth * scale}px`,
    height: `${cssHeight * scale}px`,
  };
}
