import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { LoadedPdfDocument } from '@pdf/render/types';
import { useDocumentStore } from '../../stores/documentStore';
import { useOrganizeStore } from '../../stores/organizeStore';
import { cx } from '../../utils/classNames';
import { PageThumbnail } from '../pages/PageThumbnail';
import { visiblePages } from '../viewer/viewerLayout';
import { layoutThumbnails, scrollToReveal, THUMBNAIL_WIDTH } from './thumbnailLayout';
import styles from './PagesPanel.module.css';

interface PagesPanelProps {
  document: LoadedPdfDocument;
  sessionId: string;
  currentPage: number;
}

/**
 * Page thumbnails. Clicking one takes the reader there.
 *
 * Only the entries near the view exist; the rest of the list is space. A
 * thumbnail draws itself when it comes near the screen and lets its pixels go
 * when it leaves, so a long document costs the same here as a short one.
 */
export function PagesPanel({ document, sessionId, currentPage }: PagesPanelProps): ReactElement {
  const updateView = useDocumentStore((state) => state.updateView);
  const organizing = useOrganizeStore((state) => state.active);
  const setOrganizing = useOrganizeStore((state) => state.setActive);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  const layout = useMemo(() => layoutThumbnails(document.pages), [document.pages]);
  const mounted = visiblePages(layout, scrollTop, viewportHeight);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller === null) return;
    setViewportHeight(scroller.clientHeight);
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(() => setViewportHeight(scroller.clientHeight));
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);

  // Keep the current page in sight as the reader scrolls the document.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller === null) return;
    const target = scrollToReveal(layout, currentPage, scroller.scrollTop, scroller.clientHeight);
    if (target !== null) scroller.scrollTop = target;
  }, [currentPage, layout]);

  return (
    <div
      className={styles.scroller}
      ref={scrollerRef}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <ul
        className={styles.list}
        style={{ height: `${layout.contentHeight}px` }}
        aria-label="Thumbnails"
      >
        {mounted.map((pageNumber) => {
          const page = document.pages[pageNumber - 1];
          const box = layout.boxes[pageNumber - 1];
          if (page === undefined || box === undefined) return null;
          return (
            <li
              key={pageNumber}
              className={styles.entry}
              style={{ top: `${box.top}px`, height: `${box.height}px` }}
              data-thumbnail-page={pageNumber}
            >
              <button
                type="button"
                className={cx(styles.item, pageNumber === currentPage && styles.current)}
                aria-current={pageNumber === currentPage ? 'true' : undefined}
                onClick={() => {
                  updateView(sessionId, { pendingPage: pageNumber });
                  // Going to a page means reading it, which the page grid is not.
                  if (organizing) setOrganizing(false);
                }}
              >
                <PageThumbnail document={document} page={page} width={THUMBNAIL_WIDTH} />
                <span className={styles.label}>{page.label ?? pageNumber}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
