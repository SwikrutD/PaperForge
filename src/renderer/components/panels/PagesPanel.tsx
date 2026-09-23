import { useEffect, useRef, type ReactElement } from 'react';
import type { LoadedPdfDocument } from '@pdf/render/types';
import { useDocumentStore } from '../../stores/documentStore';
import { useOrganizeStore } from '../../stores/organizeStore';
import { cx } from '../../utils/classNames';
import { PageThumbnail } from '../pages/PageThumbnail';
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
  const organizing = useOrganizeStore((state) => state.active);
  const setOrganizing = useOrganizeStore((state) => state.setActive);
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
            onClick={() => {
              updateView(sessionId, { pendingPage: page.pageNumber });
              // Going to a page means reading it, which the page grid is not.
              if (organizing) setOrganizing(false);
            }}
          >
            <PageThumbnail document={document} page={page} width={THUMBNAIL_WIDTH} />
            <span className={styles.label}>{page.label ?? page.pageNumber}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
