import { useEffect, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import type { LoadedPdfDocument, PdfLink } from '@pdf/render/types';
import { PdfPageView } from './PdfPageView';
import {
  presentationKey,
  presentationTarget,
  type PresentationAction,
} from './presentationControls';
import { INITIAL_WHEEL_TURN, wheelTurn } from './singlePage';
import { rotatedSize, scaleForMode } from './viewerLayout';
import styles from './PresentationView.module.css';

interface PresentationViewProps {
  pdf: LoadedPdfDocument;
  fileName: string;
  /** The page on show. */
  pageNumber: number;
  rotation: number;
  layersVersion: number;
  /** Follows a link that leads out of the document. */
  onFollowLink: (link: PdfLink) => void;
  onPageChange: (pageNumber: number) => void;
  /** Ends the presentation. */
  onExit: () => void;
}

/** A whole page always fits, so the wheel turns pages straight away. */
const FITTED_PAGE = { scrollTop: 0, clientHeight: 1, scrollHeight: 1 };

/**
 * Presentation mode: one page at a time, fitted to the whole screen on black,
 * with nothing else in view. Clicks, the wheel and the keys a presentation
 * clicker sends move between pages; Escape stops. Only the page on show is
 * mounted, so presenting a long document holds one page in memory.
 */
export function PresentationView({
  pdf,
  fileName,
  pageNumber: requestedPage,
  rotation,
  layersVersion,
  onFollowLink,
  onPageChange,
  onExit,
}: PresentationViewProps): ReactElement {
  const pageCount = pdf.pages.length;
  const pageNumber = Math.min(Math.max(1, requestedPage), Math.max(1, pageCount));
  const [screen, setScreen] = useState({ width: window.innerWidth, height: window.innerHeight });
  const containerRef = useRef<HTMLDivElement>(null);
  const wheelState = useRef(INITIAL_WHEEL_TURN);

  // The presentation takes the keyboard from the moment it opens.
  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  // Going full screen changes the size of the window after the page is shown.
  useEffect(() => {
    const onResize = (): void =>
      setScreen({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const act = (action: PresentationAction): void => {
    if (action === 'exit') onExit();
    else onPageChange(presentationTarget(action, pageNumber, pageCount));
  };

  const geometry = pdf.pages[pageNumber - 1];
  const label = geometry?.label ?? String(pageNumber);
  const status = `Page ${label} of ${pageCount}`;

  let stage: ReactElement | null = null;
  if (geometry !== undefined) {
    const scale = scaleForMode('fitPage', {
      page: geometry,
      viewportWidth: screen.width,
      viewportHeight: screen.height,
      viewRotation: rotation,
    });
    const size = rotatedSize(geometry, rotation);
    const width = Math.max(1, Math.round(size.width * scale));
    const height = Math.max(1, Math.round(size.height * scale));
    stage = (
      <div className={styles.stage} style={{ width: `${width}px`, height: `${height}px` }}>
        <PdfPageView
          // A new page is a new canvas; the one before is let go.
          key={pageNumber}
          document={pdf}
          box={{ pageNumber, top: 0, left: -width / 2, width, height }}
          scale={scale}
          rotation={rotation}
          label={geometry.label}
          layersVersion={layersVersion}
          showBadge={false}
          onFollowLink={(link) => {
            if (link.target.kind === 'page') onPageChange(link.target.pageNumber);
            else onFollowLink(link);
          }}
        />
      </div>
    );
  }

  return createPortal(
    <div
      ref={containerRef}
      className={styles.presentation}
      role="dialog"
      aria-modal="true"
      aria-roledescription="presentation"
      aria-label={`Presenting ${fileName}`}
      tabIndex={-1}
      data-presentation
      onKeyDown={(event) => {
        // Focus stays here: there is nothing else to move to.
        if (event.key === 'Tab') {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        // Chords still reach their commands, so Ctrl+L stops presenting.
        if (event.ctrlKey || event.altKey || event.metaKey) return;
        event.stopPropagation();
        const action = presentationKey(event.key, event.shiftKey);
        if (action === null) return;
        event.preventDefault();
        act(action);
      }}
      onWheel={(event) => {
        if (event.ctrlKey) return;
        const result = wheelTurn(wheelState.current, event.deltaY, FITTED_PAGE, event.timeStamp);
        wheelState.current = result.state;
        if (result.turn !== 0) act(result.turn === 1 ? 'next' : 'previous');
      }}
      onClick={(event) => {
        // A link takes its own click.
        if (event.target instanceof Element && event.target.closest('button') !== null) return;
        act(event.shiftKey ? 'previous' : 'next');
      }}
    >
      {stage}
      <p className="pf-visually-hidden" aria-live="polite">
        {status}
      </p>
      {/* Shown for a moment on each page, then gone: it hides itself in CSS. */}
      <div key={pageNumber} className={styles.hint} aria-hidden="true">
        {`${status} · Esc to stop`}
      </div>
    </div>,
    document.body,
  );
}
