import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Loader2 } from 'lucide-react';
import type { PdfLink } from '@pdf/render/types';
import { useDocumentStore, type DocumentTab } from '../../stores/documentStore';
import { useUiStore } from '../../stores/uiStore';
import { invoke } from '../../services/ipcClient';
import { ErrorMessageBar } from '../surfaces/MessageBar';
import { Button } from '../controls/Button';
import { PasswordPrompt } from './PasswordPrompt';
import { PdfPageView } from './PdfPageView';
import { ViewerToolbar } from './ViewerToolbar';
import { usePdfDocument } from './usePdfDocument';
import {
  currentPage as currentPageOf,
  layoutPages,
  scaleForMode,
  scrollTopForPage,
  visiblePages,
} from './viewerLayout';
import styles from './PdfViewer.module.css';

/**
 * The document workspace: a continuous, virtualized page column.
 *
 * Only pages near the viewport are mounted, so a thousand-page document costs
 * the same as a five-page one. Scroll position, zoom and rotation live with
 * the tab, so switching documents returns you exactly where you were.
 */
export function PdfViewer({ tab }: { tab: DocumentTab }): ReactElement {
  const sessionId = tab.session.id;
  const state = usePdfDocument(sessionId);
  const updateView = useDocumentStore((store) => store.updateView);
  const showToast = useUiStore((store) => store.showToast);
  const requestConfirmation = useUiStore((store) => store.requestConfirmation);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const restoredFor = useRef<string | null>(null);

  const { view } = tab;
  const pages = useMemo(() => state.document?.pages ?? [], [state.document]);

  // Fit modes depend on the page currently being read.
  const referencePage = pages[Math.min(view.pageNumber, pages.length) - 1] ?? pages[0] ?? null;
  const scale = useMemo(() => {
    if (referencePage === null || viewport.width === 0) return view.scale;
    return scaleForMode(
      view.zoomMode,
      {
        page: referencePage,
        viewportWidth: viewport.width,
        viewportHeight: viewport.height,
        viewRotation: view.rotation,
      },
      view.scale,
    );
  }, [referencePage, viewport.width, viewport.height, view.zoomMode, view.rotation, view.scale]);

  const layout = useMemo(
    () => layoutPages(pages, scale, view.rotation),
    [pages, scale, view.rotation],
  );
  const mounted = useMemo(
    () => visiblePages(layout, view.scrollTop, viewport.height),
    [layout, view.scrollTop, viewport.height],
  );

  // Track the viewport size so fit modes and virtualization stay correct.
  useEffect(() => {
    const element = scrollerRef.current;
    if (element === null) return;
    const observer = new ResizeObserver(() => {
      setViewport({ width: element.clientWidth, height: element.clientHeight });
    });
    observer.observe(element);
    setViewport({ width: element.clientWidth, height: element.clientHeight });
    return () => observer.disconnect();
  }, [state.status]);

  // Put the reader back where they were when the tab is shown again.
  useEffect(() => {
    if (state.status !== 'ready' || restoredFor.current === sessionId) return;
    const element = scrollerRef.current;
    if (element === null) return;
    restoredFor.current = sessionId;
    element.scrollTop = view.scrollTop;
  }, [state.status, sessionId, view.scrollTop]);

  const onScroll = useCallback(() => {
    const element = scrollerRef.current;
    if (element === null) return;
    const scrollTop = element.scrollTop;
    const page = currentPageOf(layout, scrollTop, element.clientHeight);
    updateView(sessionId, { scrollTop, pageNumber: page });
  }, [layout, sessionId, updateView]);

  const goToPage = useCallback(
    (pageNumber: number) => {
      const element = scrollerRef.current;
      const clamped = Math.min(Math.max(1, pageNumber), Math.max(1, pages.length));
      if (element === null) return;
      element.scrollTo({ top: scrollTopForPage(layout, clamped), behavior: 'smooth' });
    },
    [layout, pages.length],
  );

  // A command asked for a page; scroll there and clear the request.
  useEffect(() => {
    const requested = view.pendingPage;
    if (requested === null || state.status !== 'ready') return;
    goToPage(requested);
    updateView(sessionId, { pendingPage: null });
  }, [view.pendingPage, state.status, goToPage, sessionId, updateView]);

  // Ctrl+wheel zooms, like every Windows document viewer.
  useEffect(() => {
    const element = scrollerRef.current;
    if (element === null) return;
    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
      updateView(sessionId, { zoomMode: 'custom', scale: scale * factor });
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [scale, sessionId, updateView]);

  const followLink = useCallback(
    (link: PdfLink) => {
      if (link.target.kind === 'page') {
        goToPage(link.target.pageNumber);
        return;
      }
      if (link.target.kind === 'unsupported') {
        showToast({
          title: 'That link points somewhere PaperForge cannot follow.',
          intent: 'info',
        });
        return;
      }
      const url = link.target.url;
      requestConfirmation({
        title: 'Open this link outside PaperForge?',
        message: `${url}\n\nIt will open in your web browser.`,
        confirmLabel: 'Open in browser',
        onConfirm: () => {
          void invoke('shell:openExternal', { url }).catch((error: unknown) => {
            showToast({
              title: 'That link could not be opened.',
              description: String(error),
              intent: 'error',
            });
          });
        },
      });
    },
    [goToPage, requestConfirmation, showToast],
  );

  if (state.status === 'error' && state.error !== null) {
    return (
      <div className={styles.centered}>
        <div className={styles.message}>
          <ErrorMessageBar error={state.error} />
          <Button appearance="primary" onClick={state.reload}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.viewer}>
      <ViewerToolbar
        tab={tab}
        pageCount={pages.length}
        scale={scale}
        disabled={state.status !== 'ready'}
        onGoToPage={goToPage}
      />

      <div className={styles.scroller} ref={scrollerRef} onScroll={onScroll} tabIndex={0}>
        {state.status === 'ready' && state.document !== null ? (
          <div
            className={styles.content}
            style={{ height: `${layout.contentHeight}px`, minWidth: `${layout.contentWidth}px` }}
          >
            {mounted.map((pageNumber) => {
              const box = layout.boxes[pageNumber - 1];
              if (box === undefined) return null;
              return (
                <PdfPageView
                  key={pageNumber}
                  document={state.document!}
                  box={box}
                  scale={scale}
                  rotation={view.rotation}
                  label={pages[pageNumber - 1]?.label ?? null}
                  onFollowLink={followLink}
                />
              );
            })}
          </div>
        ) : (
          <div className={styles.centered}>
            <Loader2 className={styles.spinner} aria-hidden="true" />
            <p className={styles.loadingText}>
              {state.status === 'password' ? 'Waiting for the password…' : 'Opening the document…'}
            </p>
          </div>
        )}
      </div>

      {state.status === 'password' && (
        <PasswordPrompt
          fileName={tab.session.file.displayName}
          retry={state.passwordRetry}
          onSubmit={state.submitPassword}
          onCancel={state.cancelPassword}
        />
      )}
    </div>
  );
}
