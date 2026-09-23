import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Loader2 } from 'lucide-react';
import type { PdfLink, PdfPageGeometry } from '@pdf/render/types';
import { useDocumentStore, type DocumentTab } from '../../stores/documentStore';
import { currentMatch, useSearchStore } from '../../stores/searchStore';
import { useUiStore } from '../../stores/uiStore';
import { invoke } from '../../services/ipcClient';
import { ErrorMessageBar } from '../surfaces/MessageBar';
import { Button } from '../controls/Button';
import { AnnotationLayer } from '../annotations/AnnotationLayer';
import { AnnotationToolbar } from '../annotations/AnnotationToolbar';
import { DraftEditor } from '../annotations/DraftEditor';
import { useAnnotationTools } from '../annotations/useAnnotationTools';
import {
  annotationsForSession,
  annotationsOnPage,
  useAnnotationStore,
} from '../../stores/annotationStore';
import { TextEditLayer } from '../edit/TextEditLayer';
import { TextEditToolbar } from '../edit/TextEditToolbar';
import { runsFor, useTextEditStore } from '../../stores/textEditStore';
import { FindBar } from '../search/FindBar';
import { highlightsByPage } from '../search/searchNavigation';
import { pdfRectToCss } from './pageGeometry';
import { usePdfDocumentContext } from './pdfDocumentContextValue';
import { PasswordPrompt } from './PasswordPrompt';
import { PdfPageView } from './PdfPageView';
import { ViewerToolbar } from './ViewerToolbar';
import {
  currentPage as currentPageOf,
  layoutPages,
  rotatedSize,
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
  const state = usePdfDocumentContext();
  const updateView = useDocumentStore((store) => store.updateView);
  const findOpen = useSearchStore((store) => store.open);
  const highlightAll = useSearchStore((store) => store.highlightAll);
  const results = useSearchStore((store) => store.results);
  const annotations = useAnnotationStore((store) => annotationsForSession(store, sessionId));
  const selectedAnnotationId = useAnnotationStore((store) => store.selectedId);
  const selectAnnotation = useAnnotationStore((store) => store.select);
  const draft = useAnnotationStore((store) => store.draft);
  const commenting = useUiStore((store) => store.commenting);
  const toolActive = useAnnotationStore((store) => store.tool !== 'select');
  const showToast = useUiStore((store) => store.showToast);
  const editing = useTextEditStore((store) => store.active);
  const textPages = useTextEditStore((store) => store.pages);
  const textSelected = useTextEditStore((store) => store.selected);
  const textDraft = useTextEditStore((store) => store.draft);
  const textPlacement = useTextEditStore((store) => store.placement);
  const textPlacing = useTextEditStore((store) => store.placing);
  const requestConfirmation = useUiStore((store) => store.requestConfirmation);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const restoredFor = useRef<string | null>(null);
  /** The match already brought into view, so zooming does not re-scroll. */
  const shownHit = useRef<string | null>(null);

  const { view } = tab;
  const pages = useMemo(() => state.document?.pages ?? [], [state.document]);

  // Fit modes depend on the page currently being read, and on the widest page
  // so that fit width never leaves part of a page off screen.
  const referencePage = pages[Math.min(view.pageNumber, pages.length) - 1] ?? pages[0] ?? null;
  const widestPage = useMemo(() => {
    let widest = pages[0] ?? null;
    for (const page of pages) {
      const size = rotatedSize(page, view.rotation);
      const best = widest === null ? 0 : rotatedSize(widest, view.rotation).width;
      if (size.width > best) widest = page;
    }
    return widest;
  }, [pages, view.rotation]);
  const scale = useMemo(() => {
    if (referencePage === null || viewport.width === 0) return view.scale;
    return scaleForMode(
      view.zoomMode,
      {
        page: referencePage,
        widestPage: widestPage ?? referencePage,
        viewportWidth: viewport.width,
        viewportHeight: viewport.height,
        viewRotation: view.rotation,
      },
      view.scale,
    );
  }, [
    referencePage,
    widestPage,
    viewport.width,
    viewport.height,
    view.zoomMode,
    view.rotation,
    view.scale,
  ]);

  const pageLabels = useMemo(() => pages.map((page) => page.label), [pages]);
  const tools = useAnnotationTools(sessionId, tab.edit.revision, pages, scale, view.rotation);
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

  // The editor needs the text of the pages on screen, from this revision.
  useEffect(() => {
    if (!editing || state.status !== 'ready') return;
    const load = useTextEditStore.getState().load;
    for (const pageNumber of mounted) void load(sessionId, pageNumber, tab.edit.revision);
  }, [editing, state.status, mounted, sessionId, tab.edit.revision]);

  const highlights = useMemo(
    () => highlightsByPage(results.hits, sessionId, results.currentIndex, highlightAll),
    [results.hits, sessionId, results.currentIndex, highlightAll],
  );

  // Bring the match the reader is on into view, if it is not already.
  const currentHit = currentMatch(results);
  const hitForThisTab =
    currentHit !== null && currentHit.sessionId === sessionId ? currentHit : null;
  useEffect(() => {
    const element = scrollerRef.current;
    if (hitForThisTab === null || state.status !== 'ready' || element === null) return;
    if (shownHit.current === hitForThisTab.id) return;
    shownHit.current = hitForThisTab.id;

    const box = layout.boxes[hitForThisTab.pageNumber - 1];
    const geometry = pages[hitForThisTab.pageNumber - 1];
    if (box === undefined) return;

    const rect = hitForThisTab.rects[0];
    const onPage =
      rect === undefined || geometry === undefined
        ? null
        : pdfRectToCss(rect, geometry, scale, view.rotation);
    const top = box.top + (onPage?.top ?? 0);
    const bottom = top + (onPage?.height ?? box.height);

    const visibleFrom = element.scrollTop;
    const visibleTo = visibleFrom + element.clientHeight;
    if (top >= visibleFrom && bottom <= visibleTo) return;

    // A third of the way down reads better than flush against the top edge.
    element.scrollTo({
      top: Math.max(0, top - element.clientHeight / 3),
      behavior: 'smooth',
    });
  }, [hitForThisTab, state.status, layout, pages, scale, view.rotation]);

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
        pageLabels={pageLabels}
        scale={scale}
        disabled={state.status !== 'ready'}
        onGoToPage={goToPage}
      />

      {findOpen && <FindBar />}
      {editing && (
        <TextEditToolbar
          disabled={state.status !== 'ready'}
          hasText={runsFor(textPages, sessionId, view.pageNumber).length > 0}
        />
      )}
      {!editing && (commenting || toolActive) && (
        <AnnotationToolbar disabled={state.status !== 'ready'} />
      )}

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
                  layersVersion={state.layersVersion}
                  highlights={highlights.get(pageNumber)}
                  overlay={
                    state.document === null ? null : editing ? (
                      <TextEditLayer
                        geometry={state.document.pages[pageNumber - 1] as PdfPageGeometry}
                        scale={scale}
                        rotation={view.rotation}
                        runs={runsFor(textPages, sessionId, pageNumber)}
                        selectedId={textSelected?.page === pageNumber ? textSelected.id : null}
                        draft={
                          textPlacement?.page === pageNumber || textSelected?.page === pageNumber
                            ? textDraft
                            : null
                        }
                        placement={textPlacement?.page === pageNumber ? textPlacement : null}
                        placing={textPlacing}
                        onPlace={(x, y) =>
                          useTextEditStore.getState().placeText({ page: pageNumber, x, y })
                        }
                        onSelect={(id) => useTextEditStore.getState().select(pageNumber, id)}
                        onBeginEdit={(id) => useTextEditStore.getState().beginEdit(pageNumber, id)}
                        onDraft={(text) => useTextEditStore.getState().setDraft(text)}
                        onCommit={() => void useTextEditStore.getState().commitEdit()}
                        onCancel={() => useTextEditStore.getState().cancelEdit()}
                      />
                    ) : (
                      <>
                        <AnnotationLayer
                          geometry={state.document.pages[pageNumber - 1] as PdfPageGeometry}
                          scale={scale}
                          rotation={view.rotation}
                          annotations={annotationsOnPage(annotations, pageNumber)}
                          tool={tools.tool}
                          selectedId={selectedAnnotationId}
                          stampSize={tools.stampImage ?? undefined}
                          draft={draft}
                          onSelect={selectAnnotation}
                          onCreate={tools.create}
                          onMove={tools.move}
                          onErase={tools.erase}
                        />
                        {draft !== null && draft.pageNumber === pageNumber && (
                          <DraftEditor
                            draft={draft}
                            pageGeometry={state.document.pages[pageNumber - 1] as PdfPageGeometry}
                            scale={scale}
                            rotation={view.rotation}
                            onCommit={tools.commitDraft}
                            onCancel={tools.cancelDraft}
                          />
                        )}
                      </>
                    )
                  }
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
