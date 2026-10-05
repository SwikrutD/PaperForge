import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';
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
  pendingOnPage,
  useAnnotationStore,
} from '../../stores/annotationStore';
import { TextEditLayer } from '../edit/TextEditLayer';
import { ImageEditLayer } from '../edit/ImageEditLayer';
import { EditToolbar } from '../edit/EditToolbar';
import { runsFor, useTextEditStore } from '../../stores/textEditStore';
import { imagesFor, useImageEditStore } from '../../stores/imageEditStore';
import { LinkEditLayer } from '../edit/LinkEditLayer';
import { linksFor, useLinkEditStore } from '../../stores/linkEditStore';
import { useEditTargetStore } from '../../stores/editTargetStore';
import { FormLayer } from '../forms/FormLayer';
import { FillSignToolbar } from '../forms/FillSignToolbar';
import {
  fieldsOnPage,
  formFieldsFor,
  valueOf as formValueOf,
  useFormStore,
} from '../../stores/formStore';
import { useSignatureStore } from '../../stores/signatureStore';
import { FieldDesignLayer } from '../forms/FieldDesignLayer';
import { PrepareToolbar } from '../forms/PrepareToolbar';
import { FindBar } from '../search/FindBar';
import { RedactionLayer } from '../redact/RedactionLayer';
import { RedactionToolbar } from '../redact/RedactionToolbar';
import { useRedactionMarking } from '../redact/useRedactionMarking';
import { marksFor, useRedactionStore } from '../../stores/redactionStore';
import { CropLayer } from '../crop/CropLayer';
import { CropToolbar } from '../crop/CropToolbar';
import { useCropStore } from '../../stores/cropStore';
import { useAccessibilityStore } from '../../stores/accessibilityStore';
import { AccessibilityLayer } from '../accessibility/AccessibilityLayer';
import { AccessibilityToolbar } from '../accessibility/AccessibilityToolbar';
import { useMeasureStore } from '../../stores/measureStore';
import { MeasureLayer } from '../measure/MeasureLayer';
import { MeasureToolbar } from '../measure/MeasureToolbar';
import { highlightsByPage } from '../search/searchNavigation';
import { cssPointToPdf, pdfRectToCss, quarterTurns } from './pageGeometry';
import { usePdfDocumentContext } from './pdfDocumentContextValue';
import { PasswordPrompt } from './PasswordPrompt';
import { PdfPageView } from './PdfPageView';
import { ViewerToolbar } from './ViewerToolbar';
import { isolatePages } from './singlePage';
import { rowIndexOf, rowOf, rowOptionsFor, stepPage } from './pageRows';
import { usePageTurning, type PageTurn } from './usePageTurning';
import { usePanning } from './usePanning';
import { PresentationView } from './PresentationView';
import { stopPresentation } from '../../stores/presentation';
import { useMarqueeZoom } from './useMarqueeZoom';
import {
  anchorAt,
  marqueeScale,
  scrollForAnchor,
  type ContentRect,
  type PageAnchor,
} from './marqueeZoom';
import {
  currentPage as currentPageOf,
  layoutPages,
  prefersReducedMotion,
  rotatedSize,
  scaleForMode,
  scrollBehaviorFor,
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
  const pendingMarks = useAnnotationStore((store) => store.pending);
  const settlePending = useAnnotationStore((store) => store.settlePending);
  const commenting = useUiStore((store) => store.commenting);
  const toolActive = useAnnotationStore((store) => store.tool !== 'select');
  const showToast = useUiStore((store) => store.showToast);
  const editing = useTextEditStore((store) => store.active);
  const textPages = useTextEditStore((store) => store.pages);
  const textSelected = useTextEditStore((store) => store.selected);
  const textDraft = useTextEditStore((store) => store.draft);
  const textPlacement = useTextEditStore((store) => store.placement);
  const textPlacing = useTextEditStore((store) => store.placing);
  const textPending = useTextEditStore((store) => store.pendingText);
  const settleTextPending = useTextEditStore((store) => store.settlePending);
  const editTarget = useEditTargetStore((store) => store.target);
  const imagePages = useImageEditStore((store) => store.pages);
  const imageSelected = useImageEditStore((store) => store.selected);
  const imageDrag = useImageEditStore((store) => store.drag);
  const imagePending = useImageEditStore((store) => store.pending);
  const imageMoved = useImageEditStore((store) => store.moved);
  const settleImageMoved = useImageEditStore((store) => store.settleMoved);
  const linkPages = useLinkEditStore((store) => store.pages);
  const linkSelected = useLinkEditStore((store) => store.selected);
  const linkDrag = useLinkEditStore((store) => store.drag);
  const linkDrawn = useLinkEditStore((store) => store.drawn);
  const linkDrawing = useLinkEditStore((store) => store.drawing);
  const filling = useFormStore((store) => store.active);
  const forms = useFormStore((store) => store.forms);
  const formDrafts = useFormStore((store) => store.drafts);
  const formSelected = useFormStore((store) => store.selected);
  const formHighlight = useFormStore((store) => store.highlight);
  const formProblems = useFormStore((store) => store.problems);
  const stagedSignature = useSignatureStore((store) => store.staged);
  const preparing = useFormStore((store) => store.preparing);
  const fieldTool = useFormStore((store) => store.fieldTool);
  const fieldDrag = useFormStore((store) => store.drag);
  const fieldDrawn = useFormStore((store) => store.drawn);
  const requestConfirmation = useUiStore((store) => store.requestConfirmation);
  const redacting = useRedactionStore((store) => store.active);
  const redactionTool = useRedactionStore((store) => store.tool);
  const redactionMarks = useRedactionStore((store) => marksFor(store.marks, sessionId));
  const redactionSelected = useRedactionStore((store) => store.selectedId);
  const cropping = useCropStore((store) => store.active);
  const cropFrame = useCropStore((store) => store.frame);
  const checkingAccessibility = useAccessibilityStore((store) => store.active);
  const measuring = useMeasureStore((store) => store.active);
  const showReadingOrder = useAccessibilityStore((store) => store.showReadingOrder);
  const readingOrders = useAccessibilityStore((store) => store.orders);
  const readingOrderFor = useAccessibilityStore((store) => store.orderFor);
  const accessibilityFocus = useAccessibilityStore((store) => store.focused);

  const viewerTool = useUiStore((store) => store.viewerTool);
  const presentationPage = useUiStore((store) => store.presentation?.pageNumber ?? null);
  // Any tool that works on the pages — editing, marking, measuring, drawing a
  // comment — has the pointer; the hand only has it when none of them does.
  const pagesTaken =
    editing || filling || redacting || cropping || checkingAccessibility || measuring || toolActive;
  const activeViewerTool = pagesTaken ? 'select' : viewerTool;

  const scrollerRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const restoredFor = useRef<string | null>(null);
  /** The match already brought into view, so zooming does not re-scroll. */
  const shownHit = useRef<string | null>(null);

  const { view } = tab;
  const pages = useMemo(() => state.document?.pages ?? [], [state.document]);

  const rowOptions = useMemo(
    () => rowOptionsFor({ spread: view.spread, coverPage: view.coverPage }),
    [view.spread, view.coverPage],
  );
  const spread = view.spread !== 'none';

  // Fit modes depend on the page currently being read, and on the widest page
  // so that fit width never leaves part of a page off screen. In a spread the
  // pages side by side are fitted together.
  const referencePage = useMemo(() => {
    const row = rowOf(view.pageNumber, pages.length, rowOptions)
      .map((pageNumber) => pages[pageNumber - 1])
      .filter((page) => page !== undefined);
    if (row.length === 0) return pages[0] ?? null;
    return {
      width: Math.max(...row.map((page) => page.width)),
      height: Math.max(...row.map((page) => page.height)),
    };
  }, [pages, view.pageNumber, rowOptions]);
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
        columns: spread ? 2 : 1,
      },
      view.scale,
    );
  }, [
    spread,
    referencePage,
    widestPage,
    viewport.width,
    viewport.height,
    view.zoomMode,
    view.rotation,
    view.scale,
  ]);

  const pageLabels = useMemo(() => pages.map((page) => page.label), [pages]);
  const tools = useAnnotationTools(
    sessionId,
    tab.edit.revision,
    pages,
    scale,
    view.rotation,
    stagedSignature,
  );
  useRedactionMarking(sessionId, pages, scale, view.rotation);
  // Single-page view shows the page being read and nothing else; continuous
  // view lays out the whole column and mounts what is near the viewport.
  const single = view.pageMode === 'single';
  const shownPages = useMemo(
    () =>
      single && view.pageNumber <= pages.length
        ? rowOf(view.pageNumber, pages.length, rowOptions)
        : null,
    [single, view.pageNumber, pages.length, rowOptions],
  );
  const columnLayout = useMemo(
    () => layoutPages(pages, scale, view.rotation, rowOptions),
    [pages, scale, view.rotation, rowOptions],
  );
  const layout = useMemo(
    () => (shownPages === null ? columnLayout : isolatePages(columnLayout, shownPages)),
    [columnLayout, shownPages],
  );
  const mounted = useMemo(
    () => shownPages ?? visiblePages(layout, view.scrollTop, viewport.height),
    [shownPages, layout, view.scrollTop, viewport.height],
  );
  /** Where single-page view should scroll once the next page is laid out. */
  const pendingEdge = useRef<'top' | 'bottom' | null>(null);

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
    // In single-page view the page only changes when it is turned.
    const page = single ? view.pageNumber : currentPageOf(layout, scrollTop, element.clientHeight);
    updateView(sessionId, {
      scrollTop,
      pageNumber: page,
      viewTop: viewTopOf(layout.boxes[page - 1], pages[page - 1], scrollTop, scale, view.rotation),
    });
  }, [single, view.pageNumber, layout, pages, scale, view.rotation, sessionId, updateView]);

  /** Shows a page in single-page view, scrolled to one of its ends. */
  const showPage = useCallback(
    (pageNumber: number, edge: 'top' | 'bottom') => {
      const element = scrollerRef.current;
      if (rowIndexOf(pageNumber, rowOptions) === rowIndexOf(view.pageNumber, rowOptions)) {
        if (element !== null) element.scrollTop = edge === 'top' ? 0 : element.scrollHeight;
        return;
      }
      pendingEdge.current = edge;
      updateView(sessionId, { pageNumber, viewTop: null });
    },
    [view.pageNumber, rowOptions, sessionId, updateView],
  );

  const goToPage = useCallback(
    (pageNumber: number) => {
      const element = scrollerRef.current;
      const clamped = Math.min(Math.max(1, pageNumber), Math.max(1, pages.length));
      if (element === null) return;
      if (single) {
        showPage(clamped, 'top');
        return;
      }
      const top = scrollTopForPage(layout, clamped);
      element.scrollTo({
        top,
        behavior: scrollBehaviorFor(
          top - element.scrollTop,
          element.clientHeight,
          prefersReducedMotion(),
        ),
      });
    },
    [single, showPage, layout, pages.length],
  );

  const turnPage = useCallback(
    (turn: PageTurn) => {
      const target =
        turn === 'first'
          ? 1
          : turn === 'last'
            ? stepPage(pages.length, 0, pages.length, rowOptions)
            : stepPage(view.pageNumber, turn === 'next' ? 1 : -1, pages.length, rowOptions);
      if (rowIndexOf(target, rowOptions) === rowIndexOf(view.pageNumber, rowOptions)) return;
      // Turning back lands at the foot of the page, as reading backwards would.
      showPage(target, turn === 'previous' ? 'bottom' : 'top');
    },
    [pages.length, view.pageNumber, rowOptions, showPage],
  );
  usePageTurning(scrollerRef, single && state.status === 'ready', turnPage);
  usePanning(scrollerRef, activeViewerTool === 'hand' && state.status === 'ready');

  // Marquee zoom: the rectangle being drawn, and the point to centre on once
  // the new zoom is laid out.
  const [marquee, setMarquee] = useState<ContentRect | null>(null);
  const pendingAnchor = useRef<PageAnchor | null>(null);
  const centreOn = useCallback((anchor: PageAnchor, onLayout: typeof layout) => {
    const element = scrollerRef.current;
    if (element === null) return;
    const target = scrollForAnchor(onLayout, anchor, {
      width: element.clientWidth,
      height: element.clientHeight,
    });
    if (target === null) return;
    element.scrollLeft = target.left;
    element.scrollTop = target.top;
  }, []);
  const finishMarquee = useCallback(
    (rect: ContentRect, zoomOut: boolean) => {
      const element = scrollerRef.current;
      if (element === null) return;
      const centre = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      const anchor = anchorAt(layout, centre, element.clientWidth, mounted);
      if (anchor === null) return;
      const viewportSize = { width: element.clientWidth, height: element.clientHeight };
      const nextScale = marqueeScale(scale, rect, viewportSize, zoomOut);
      if (Math.abs(nextScale - scale) < 0.0001) {
        centreOn(anchor, layout);
        return;
      }
      pendingAnchor.current = anchor;
      updateView(sessionId, { zoomMode: 'custom', scale: nextScale });
    },
    [layout, mounted, scale, centreOn, sessionId, updateView],
  );
  const marqueeHandlers = useMemo(
    () => ({ onDraw: setMarquee, onFinish: finishMarquee }),
    [finishMarquee],
  );
  useMarqueeZoom(
    scrollerRef,
    activeViewerTool === 'marqueeZoom' && state.status === 'ready',
    marqueeHandlers,
  );
  useLayoutEffect(() => {
    const anchor = pendingAnchor.current;
    if (anchor === null) return;
    pendingAnchor.current = null;
    centreOn(anchor, layout);
  }, [layout, centreOn]);

  // A turned page is scrolled to the end it was entered from, once it is laid out.
  useLayoutEffect(() => {
    const element = scrollerRef.current;
    const edge = pendingEdge.current;
    if (edge === null || element === null) return;
    pendingEdge.current = null;
    element.scrollTop = edge === 'top' ? 0 : element.scrollHeight;
  }, [layout]);

  // Changing the page layout — continuous or single page, column or spread —
  // keeps the page being read.
  const layoutKey = `${view.pageMode}/${view.spread}/${String(view.coverPage)}`;
  const shownLayout = useRef(layoutKey);
  useLayoutEffect(() => {
    const element = scrollerRef.current;
    if (shownLayout.current === layoutKey || element === null) return;
    shownLayout.current = layoutKey;
    element.scrollTop = single ? 0 : scrollTopForPage(layout, view.pageNumber);
    updateView(sessionId, { scrollTop: element.scrollTop });
  }, [layoutKey, single, layout, view.pageNumber, sessionId, updateView]);

  // A command asked for a page; scroll there and clear the request.
  useEffect(() => {
    const requested = view.pendingPage;
    if (requested === null || state.status !== 'ready') return;
    goToPage(requested);
    updateView(sessionId, { pendingPage: null });
  }, [view.pendingPage, state.status, goToPage, sessionId, updateView]);

  // A mark made in a revision that undo has stepped back past is gone.
  useEffect(() => {
    useAnnotationStore.getState().dropUndonePending(sessionId, tab.edit.revision);
    useTextEditStore.getState().dropUndonePending(sessionId, tab.edit.revision);
    useImageEditStore.getState().dropUndoneMoved(sessionId, tab.edit.revision);
  }, [sessionId, tab.edit.revision]);

  // The editor needs the text of the pages on screen, from this revision.
  useEffect(() => {
    if (!editing || state.status !== 'ready') return;
    const load = useTextEditStore.getState().load;
    for (const pageNumber of mounted) void load(sessionId, pageNumber, tab.edit.revision);
  }, [editing, state.status, mounted, sessionId, tab.edit.revision]);

  // The crop tool measures from the boxes each page declares, at this revision.
  useEffect(() => {
    if (!cropping || state.status !== 'ready') return;
    void useCropStore.getState().loadBoxes(sessionId, tab.edit.revision);
  }, [cropping, state.status, sessionId, tab.edit.revision]);

  // The reading order is read a page at a time, for the pages on screen.
  useEffect(() => {
    if (!checkingAccessibility || !showReadingOrder || state.status !== 'ready') return;
    const load = useAccessibilityStore.getState().loadReadingOrder;
    for (const pageNumber of mounted) void load(sessionId, tab.edit.revision, pageNumber);
  }, [
    checkingAccessibility,
    showReadingOrder,
    state.status,
    mounted,
    sessionId,
    tab.edit.revision,
  ]);

  // The form is read whole, because a field can be drawn on several pages.
  useEffect(() => {
    if (!filling || state.status !== 'ready') return;
    void useFormStore.getState().load(sessionId, tab.edit.revision);
  }, [filling, state.status, sessionId, tab.edit.revision]);

  // And the images and links, read the same way and from the same revision.
  useEffect(() => {
    if (!editing || state.status !== 'ready') return;
    const loadImages = useImageEditStore.getState().load;
    const loadLinks = useLinkEditStore.getState().load;
    for (const pageNumber of mounted) {
      void loadImages(sessionId, pageNumber, tab.edit.revision);
      void loadLinks(sessionId, pageNumber, tab.edit.revision);
    }
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
    // Single-page view turns to the match's page first; this runs again once
    // that page is laid out.
    if (shownPages !== null && !shownPages.includes(hitForThisTab.pageNumber)) {
      updateView(sessionId, { pageNumber: hitForThisTab.pageNumber });
      return;
    }
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
    const target = Math.max(0, top - element.clientHeight / 3);
    element.scrollTo({
      top: target,
      behavior: scrollBehaviorFor(
        target - element.scrollTop,
        element.clientHeight,
        prefersReducedMotion(),
      ),
    });
  }, [
    hitForThisTab,
    state.status,
    shownPages,
    layout,
    pages,
    scale,
    view.rotation,
    sessionId,
    updateView,
  ]);

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
          <div className={styles.messageActions}>
            <Button onClick={() => useUiStore.getState().openDialog('repair')}>
              Check and repair…
            </Button>
            <Button appearance="primary" onClick={state.reload}>
              Try again
            </Button>
          </div>
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
        <EditToolbar
          disabled={state.status !== 'ready'}
          hasText={runsFor(textPages, sessionId, view.pageNumber).length > 0}
          hasImages={imagesFor(imagePages, sessionId, view.pageNumber).length > 0}
          hasLinks={linksFor(linkPages, sessionId, view.pageNumber).length > 0}
        />
      )}
      {filling && preparing && <PrepareToolbar disabled={state.status !== 'ready'} />}
      {filling && !preparing && <FillSignToolbar disabled={state.status !== 'ready'} />}
      {redacting && <RedactionToolbar disabled={state.status !== 'ready'} />}
      {cropping && <CropToolbar />}
      {checkingAccessibility && <AccessibilityToolbar />}
      {measuring && <MeasureToolbar />}
      {!editing &&
        !filling &&
        !redacting &&
        !cropping &&
        !checkingAccessibility &&
        !measuring &&
        (commenting || toolActive) && <AnnotationToolbar disabled={state.status !== 'ready'} />}

      <div
        className={styles.scroller}
        ref={scrollerRef}
        onScroll={onScroll}
        tabIndex={0}
        role="region"
        aria-label="Document pages"
        data-tool={activeViewerTool}
      >
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
                  revision={state.revision}
                  layersVersion={state.layersVersion}
                  hideFormFields={filling}
                  highlights={highlights.get(pageNumber)}
                  overlay={
                    state.document === null ? null : measuring ? (
                      <MeasureLayer
                        sessionId={sessionId}
                        geometry={state.document.pages[pageNumber - 1] as PdfPageGeometry}
                        scale={scale}
                        rotation={view.rotation}
                      />
                    ) : checkingAccessibility ? (
                      <AccessibilityLayer
                        geometry={state.document.pages[pageNumber - 1] as PdfPageGeometry}
                        scale={scale}
                        rotation={view.rotation}
                        order={
                          showReadingOrder &&
                          readingOrderFor?.sessionId === sessionId &&
                          readingOrderFor.revision === tab.edit.revision
                            ? (readingOrders.get(pageNumber) ?? null)
                            : null
                        }
                        focused={
                          accessibilityFocus?.sessionId === sessionId &&
                          accessibilityFocus.page === pageNumber
                            ? accessibilityFocus.rect
                            : null
                        }
                      />
                    ) : cropping ? (
                      <CropLayer
                        geometry={state.document.pages[pageNumber - 1] as PdfPageGeometry}
                        scale={scale}
                        rotation={view.rotation}
                        frame={
                          cropFrame?.sessionId === sessionId && cropFrame.page === pageNumber
                            ? cropFrame.rect
                            : null
                        }
                        onChange={(rect) =>
                          useCropStore.getState().setFrame({ sessionId, page: pageNumber, rect })
                        }
                      />
                    ) : redacting ? (
                      <RedactionLayer
                        geometry={state.document.pages[pageNumber - 1] as PdfPageGeometry}
                        scale={scale}
                        rotation={view.rotation}
                        marks={redactionMarks.filter((mark) => mark.page === pageNumber)}
                        selectedId={redactionSelected}
                        tool={redactionTool}
                        onSelect={(id) => useRedactionStore.getState().select(id)}
                        onRemove={(id) => useRedactionStore.getState().removeMark(sessionId, id)}
                        onDraw={(rect) =>
                          useRedactionStore.getState().addMark(sessionId, {
                            page: pageNumber,
                            rects: [rect],
                            source: 'area',
                            label: 'Area',
                          })
                        }
                      />
                    ) : filling && preparing ? (
                      <FieldDesignLayer
                        geometry={state.document.pages[pageNumber - 1] as PdfPageGeometry}
                        scale={scale}
                        rotation={view.rotation}
                        widgets={fieldsOnPage(formFieldsFor(forms, sessionId), pageNumber)}
                        selected={formSelected}
                        drag={fieldDrag}
                        tool={fieldTool}
                        drawn={fieldDrawn?.page === pageNumber ? fieldDrawn.rect : null}
                        onSelect={(name) => useFormStore.getState().select(name)}
                        onDrag={(name, rect) => useFormStore.getState().setDrag({ name, rect })}
                        onDrop={(name, rect) => void useFormStore.getState().moveField(name, rect)}
                        onDraw={(rect) => void useFormStore.getState().addField(pageNumber, rect)}
                      />
                    ) : filling ? (
                      <>
                        {/* A signature is an annotation, so the layer that
                            places a stamp places one. The fields sit over it,
                            and only the fields themselves take the pointer. */}
                        <AnnotationLayer
                          geometry={state.document.pages[pageNumber - 1] as PdfPageGeometry}
                          scale={scale}
                          rotation={view.rotation}
                          annotations={annotationsOnPage(annotations, pageNumber)}
                          tool={tools.tool}
                          selectedId={selectedAnnotationId}
                          stampSize={tools.stampImage ?? undefined}
                          draft={draft}
                          pending={pendingOnPage(pendingMarks, sessionId, pageNumber)}
                          onSettle={settlePending}
                          onSelect={selectAnnotation}
                          onCreate={(geometry, placedOn) => {
                            tools.create(geometry, placedOn);
                            useSignatureStore.getState().clearStaged();
                          }}
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
                        <FormLayer
                          geometry={state.document.pages[pageNumber - 1] as PdfPageGeometry}
                          scale={scale}
                          rotation={view.rotation}
                          widgets={fieldsOnPage(formFieldsFor(forms, sessionId), pageNumber)}
                          valueOf={(field) => formValueOf(formDrafts, field)}
                          selected={formSelected}
                          highlight={formHighlight}
                          problems={formProblems}
                          interactive={tools.tool === 'select'}
                          onSelect={(name) => useFormStore.getState().select(name)}
                          onDraft={(name, value) => useFormStore.getState().setDraft(name, value)}
                          onCommit={(name, value) =>
                            void useFormStore.getState().commit(name, value)
                          }
                        />
                      </>
                    ) : editing && editTarget === 'links' ? (
                      <LinkEditLayer
                        geometry={state.document.pages[pageNumber - 1] as PdfPageGeometry}
                        scale={scale}
                        rotation={view.rotation}
                        links={linksFor(linkPages, sessionId, pageNumber)}
                        selectedId={linkSelected?.page === pageNumber ? linkSelected.id : null}
                        drag={linkDrag?.page === pageNumber ? linkDrag : null}
                        drawing={linkDrawing}
                        drawn={linkDrawn?.page === pageNumber ? linkDrawn.rect : null}
                        onSelect={(id) => useLinkEditStore.getState().select(pageNumber, id)}
                        onDrag={(id, rect) =>
                          useLinkEditStore.getState().setDrag({ page: pageNumber, id, rect })
                        }
                        onDrop={(id, rect) =>
                          void useLinkEditStore.getState().update(pageNumber, id, { rect })
                        }
                        onDraw={(rect) => void useLinkEditStore.getState().create(pageNumber, rect)}
                      />
                    ) : editing && editTarget === 'images' ? (
                      <ImageEditLayer
                        geometry={state.document.pages[pageNumber - 1] as PdfPageGeometry}
                        scale={scale}
                        rotation={view.rotation}
                        images={imagesFor(imagePages, sessionId, pageNumber)}
                        selectedId={imageSelected?.page === pageNumber ? imageSelected.id : null}
                        drag={imageDrag?.page === pageNumber ? imageDrag : null}
                        placing={imagePending !== null}
                        moved={
                          imageMoved?.sessionId === sessionId && imageMoved.page === pageNumber
                            ? imageMoved
                            : null
                        }
                        onSettle={settleImageMoved}
                        onSelect={(id) => useImageEditStore.getState().select(pageNumber, id)}
                        onDrag={(id, placement) =>
                          useImageEditStore.getState().setDrag({ page: pageNumber, id, placement })
                        }
                        onDrop={(id, placement, picture) =>
                          void useImageEditStore
                            .getState()
                            .place(pageNumber, id, placement, picture)
                        }
                        onPlace={(x, y) =>
                          void useImageEditStore.getState().addAt(pageNumber, x, y)
                        }
                      />
                    ) : editing ? (
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
                        pending={
                          textPending?.sessionId === sessionId && textPending.page === pageNumber
                            ? textPending
                            : null
                        }
                        onSettle={settleTextPending}
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
                          pending={pendingOnPage(pendingMarks, sessionId, pageNumber)}
                          onSettle={settlePending}
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
        {marquee !== null && (
          <div
            className={styles.marquee}
            style={{
              left: `${marquee.left}px`,
              top: `${marquee.top}px`,
              width: `${marquee.width}px`,
              height: `${marquee.height}px`,
            }}
            data-marquee
            aria-hidden="true"
          />
        )}
      </div>

      {presentationPage !== null && state.status === 'ready' && state.document !== null && (
        <PresentationView
          pdf={state.document}
          fileName={tab.session.file.displayName}
          pageNumber={presentationPage}
          rotation={view.rotation}
          layersVersion={state.layersVersion}
          onFollowLink={followLink}
          onPageChange={(pageNumber) => useUiStore.getState().setPresentationPage(pageNumber)}
          onExit={() => void stopPresentation()}
        />
      )}

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

/**
 * The height on a page at the top of the window, in PDF units: where a
 * bookmark set to the current view should land. Null when the page starts
 * below the top of the window, or is turned so that its height runs across.
 */
function viewTopOf(
  box: { top: number } | undefined,
  geometry: PdfPageGeometry | undefined,
  scrollTop: number,
  scale: number,
  rotation: number,
): number | null {
  if (box === undefined || geometry === undefined) return null;
  const offset = scrollTop - box.top;
  if (offset <= 0 || quarterTurns(geometry.rotation + rotation) !== 0) return null;
  return Math.round(cssPointToPdf({ x: 0, y: offset }, geometry, scale, rotation).y * 100) / 100;
}
