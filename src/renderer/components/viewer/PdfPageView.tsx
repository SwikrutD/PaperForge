import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import type { LoadedPdfDocument, PdfLink } from '@pdf/render/types';
import { cssBoxStyle, pdfRectToCss, rectFromCorners, type PdfRect } from './pageGeometry';
import { PaintedRevisionContext } from './paintedRevision';
import type { PageBox } from './viewerLayout';
import styles from './PdfPageView.module.css';

/**
 * Most pixels one page's canvas may hold on screen: about 64 MB. A page zoomed
 * further is drawn at this resolution and stretched, so a deep zoom stays
 * within memory; the text layer above it stays exact for selection and search.
 */
export const MAX_PAGE_CANVAS_PIXELS = 16_777_216;

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
  /** The document revision `document` was loaded from. */
  revision?: number;
  /** Bumped when layer visibility changes, which requires a repaint. */
  layersVersion: number;
  /** Leaves the form fields out of the canvas while they are being filled in. */
  hideFormFields?: boolean;
  highlights?: readonly PageHighlight[] | undefined;
  /** Comment tools and hit areas, which sit over the text layer. */
  overlay?: ReactNode;
  /** The page number in the corner; presentation mode leaves it off. */
  showBadge?: boolean;
  onFollowLink: (link: PdfLink) => void;
}

/**
 * One page: the rendered canvas, a selectable text layer on top of it, and
 * link hotspots. Rendering is cancelled when the page scrolls out of view or
 * the zoom changes, so a fast scroll never queues work nobody will see.
 *
 * The page is drawn off screen and copied onto the visible canvas in one step,
 * so the picture already showing stays until its replacement is complete: a
 * zoom, a new revision or a layer change never shows an empty page. Overlays
 * learn which revision is actually on screen through `PaintedRevisionContext`,
 * so a mark that is still being written can stay visible until the picture
 * includes it.
 */
export function PdfPageView({
  document: pdf,
  box,
  scale,
  rotation,
  label,
  revision = 0,
  layersVersion,
  hideFormFields = false,
  highlights,
  overlay,
  showBadge = true,
  onFollowLink,
}: PdfPageViewProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [links, setLinks] = useState<PdfLink[]>([]);
  const [failed, setFailed] = useState(false);
  const [rendered, setRendered] = useState(false);
  /** The revision whose picture the canvas holds, once one has been drawn. */
  const [painted, setPainted] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const canvas = canvasRef.current;
    const textLayer = textRef.current;
    if (canvas === null || textLayer === null) return;

    setFailed(false);
    setRendered(false);
    const render = async (): Promise<void> => {
      const staging = window.document.createElement('canvas');
      try {
        await pdf.renderPage({
          pageNumber: box.pageNumber,
          scale,
          rotation,
          canvas: staging,
          devicePixelRatio: window.devicePixelRatio || 1,
          maxCanvasPixels: MAX_PAGE_CANVAS_PIXELS,
          hideFormFields,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        presentCanvas(canvas, staging);
      } finally {
        // Give the staging pixels back now rather than whenever it is collected.
        staging.width = 0;
        staging.height = 0;
      }
      setRendered(true);
      setPainted(revision);
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
  }, [pdf, revision, box.pageNumber, scale, rotation, layersVersion, hideFormFields]);

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
      style={{
        top: `${box.top}px`,
        left: `calc(50% + ${box.left}px)`,
        width: `${box.width}px`,
        height: `${box.height}px`,
      }}
      data-page-number={box.pageNumber}
      data-rendered={rendered ? 'true' : undefined}
      data-revision={revision}
      data-painted-revision={painted ?? undefined}
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

      <PaintedRevisionContext.Provider value={painted}>{overlay}</PaintedRevisionContext.Provider>

      {failed && (
        <div className={styles.failed} role="status">
          This page could not be rendered.
        </div>
      )}
      {showBadge && (
        <span className={styles.badge} aria-hidden="true">
          {label ?? box.pageNumber}
        </span>
      )}
    </div>
  );
}

/**
 * Puts a finished picture on the visible canvas. Resizing a canvas clears it,
 * but the resize and the copy happen in the same task, and the browser only
 * paints between tasks — so no frame ever shows the cleared canvas.
 */
function presentCanvas(target: HTMLCanvasElement, source: HTMLCanvasElement): void {
  if (target.width !== source.width) target.width = source.width;
  if (target.height !== source.height) target.height = source.height;
  const context = target.getContext('2d');
  if (context === null) return;
  context.clearRect(0, 0, target.width, target.height);
  context.drawImage(source, 0, 0);
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
