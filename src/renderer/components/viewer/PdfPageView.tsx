import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import type { LoadedPdfDocument, PdfLink } from '@pdf/render/types';
import { cssBoxStyle, pdfRectToCss, rectFromCorners, type PdfRect } from './pageGeometry';
import type { PageBox } from './viewerLayout';
import styles from './PdfPageView.module.css';

/** A rectangle the viewer draws over the page, such as a search result. */
export interface PageHighlight {
  id: string;
  rect: PdfRect;
  /** The match the reader is currently on, drawn more strongly. */
  active: boolean;
}

interface PdfPageViewProps {
  document: LoadedPdfDocument;
  box: PageBox;
  scale: number;
  rotation: number;
  label: string | null;
  /** Bumped when layer visibility changes, which requires a repaint. */
  layersVersion: number;
  highlights?: readonly PageHighlight[] | undefined;
  /** Comment tools and hit areas, which sit over the text layer. */
  overlay?: ReactNode;
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
  highlights,
  overlay,
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

      {(highlights ?? []).map((highlight) => {
        const position = place(highlight.rect, pdf, box.pageNumber, scale, rotation);
        if (position === null) return null;
        return (
          <span
            key={highlight.id}
            className={highlight.active ? styles.highlightActive : styles.highlight}
            style={position}
            data-search-highlight={highlight.active ? 'current' : 'match'}
            aria-hidden="true"
          />
        );
      })}

      <div className={styles.textLayer} ref={textRef} />

      {links.map((link) => {
        const position = place(rectFromCorners(link.rect), pdf, box.pageNumber, scale, rotation);
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

      {overlay}

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

/** Positions a PDF-space rectangle on this page, in CSS pixels. */
function place(
  rect: PdfRect,
  pdf: LoadedPdfDocument,
  pageNumber: number,
  scale: number,
  rotation: number,
): { left: string; top: string; width: string; height: string } | null {
  const geometry = pdf.pages[pageNumber - 1];
  if (geometry === undefined) return null;
  const box = pdfRectToCss(rect, geometry, scale, rotation);
  return box === null ? null : cssBoxStyle(box);
}
