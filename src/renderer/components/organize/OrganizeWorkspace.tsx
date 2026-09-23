import { useEffect, useState, type ReactElement } from 'react';
import { Loader2 } from 'lucide-react';
import type { LoadedPdfDocument, PdfOutlineItem } from '@pdf/render/types';
import type { DocumentTab } from '../../stores/documentStore';
import { useOrganizeStore } from '../../stores/organizeStore';
import { ErrorMessageBar } from '../surfaces/MessageBar';
import { Button } from '../controls/Button';
import { usePdfDocumentContext } from '../viewer/pdfDocumentContextValue';
import { useDocumentStore } from '../../stores/documentStore';
import { CropDialog } from './CropDialog';
import { ExtractDialog } from './ExtractDialog';
import { LabelsDialog } from './LabelsDialog';
import { OrganizeToolbar } from './OrganizeToolbar';
import { PageGrid } from './PageGrid';
import { SplitDialog, type SplitBoundary } from './SplitDialog';
import { useOrganizeActions } from './useOrganizeActions';
import styles from './OrganizeWorkspace.module.css';

/** The bookmarks read, and which document they were read from. */
interface OutlineFor {
  document: LoadedPdfDocument | null;
  boundaries: readonly SplitBoundary[];
}

const NO_OUTLINE: OutlineFor = { document: null, boundaries: [] };

/**
 * Organize Pages: the whole document as a grid of pages to rearrange.
 *
 * It replaces the reading view while it is open and shares everything else with
 * it — the same document, the same undo history, the same save. Nothing is
 * written to the file until the document is saved.
 */
export function OrganizeWorkspace({ tab }: { tab: DocumentTab }): ReactElement {
  const sessionId = tab.session.id;
  const state = usePdfDocumentContext();
  const selection = useOrganizeStore((store) => store.selection);
  const setSelection = useOrganizeStore((store) => store.setSelection);
  const choose = useOrganizeStore((store) => store.choose);
  const chooseAll = useOrganizeStore((store) => store.chooseAll);
  const clearSelection = useOrganizeStore((store) => store.clearSelection);
  const dialog = useOrganizeStore((store) => store.dialog);
  const openDialog = useOrganizeStore((store) => store.openDialog);
  const loadBoxes = useOrganizeStore((store) => store.loadBoxes);
  const setActive = useOrganizeStore((store) => store.setActive);
  const updateView = useDocumentStore((store) => store.updateView);

  const pageCount = state.document?.pages.length ?? tab.pageCount;
  const baseName = tab.session.file.displayName.replace(/\.pdf$/i, '');
  const actions = useOrganizeActions(pageCount, baseName);
  const [outline, setOutline] = useState<OutlineFor>(NO_OUTLINE);

  // Pages are chosen per document, so a different document starts fresh.
  useEffect(() => {
    clearSelection();
  }, [sessionId, clearSelection]);

  // The boxes come from the document as it stands, so they are read again after
  // every change; the store ignores a request it has already answered.
  useEffect(() => {
    if (state.status !== 'ready') return;
    void loadBoxes(sessionId, tab.edit.revision);
  }, [state.status, sessionId, tab.edit.revision, loadBoxes]);

  // Top-level bookmarks are what "split by bookmark" means, and they move with
  // the pages, so they are read again from each revision. Until this revision's
  // bookmarks have arrived there are none, which is derived rather than stored.
  const document = state.document;
  const boundaries = outline.document === document ? outline.boundaries : NO_OUTLINE.boundaries;
  useEffect(() => {
    if (document === null) return;
    let cancelled = false;
    void document
      .getOutline()
      .then((items) => {
        if (!cancelled) setOutline({ document, boundaries: topLevelBoundaries(items) });
      })
      .catch(() => {
        if (!cancelled) setOutline({ document, boundaries: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [document]);

  // Grid keys: select everything, drop the selection, remove pages.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || dialog !== null) return;
      const target = event.target;
      // Never while a field has focus: those keys belong to the field.
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        chooseAll(pageCount);
      } else if (event.key === 'Escape' && selection.pages.length > 0) {
        event.preventDefault();
        clearSelection();
      } else if (event.key === 'Delete' && selection.pages.length > 0) {
        event.preventDefault();
        actions.remove();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dialog, selection.pages.length, pageCount, chooseAll, clearSelection, actions]);

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
    <div className={styles.workspace}>
      <OrganizeToolbar
        actions={actions}
        pageCount={pageCount}
        sessionId={sessionId}
        disabled={state.status !== 'ready'}
      />

      <div className={styles.scroller}>
        {state.status === 'ready' && document !== null ? (
          <PageGrid
            document={document}
            version={tab.edit.revision}
            selection={selection}
            onSelect={setSelection}
            onChoose={choose}
            onMove={actions.move}
            onOpenPage={(pageNumber) => {
              // A double click means "show me this page", which is the reading
              // view's job.
              updateView(sessionId, { pendingPage: pageNumber });
              setActive(false);
            }}
          />
        ) : (
          <div className={styles.centered}>
            <Loader2 className={styles.spinner} aria-hidden="true" />
            <p className={styles.loadingText}>Reading the pages…</p>
          </div>
        )}
      </div>

      {dialog === 'extract' && (
        <ExtractDialog actions={actions} pageCount={pageCount} onClose={() => openDialog(null)} />
      )}
      {dialog === 'split' && (
        <SplitDialog
          actions={actions}
          pageCount={pageCount}
          baseName={baseName}
          boundaries={boundaries}
          onClose={() => openDialog(null)}
        />
      )}
      {dialog === 'crop' && (
        <CropDialog actions={actions} pageCount={pageCount} onClose={() => openDialog(null)} />
      )}
      {dialog === 'labels' && (
        <LabelsDialog actions={actions} pageCount={pageCount} onClose={() => openDialog(null)} />
      )}
    </div>
  );
}

/** The top-level bookmarks that point at a page, in page order. */
function topLevelBoundaries(outline: readonly PdfOutlineItem[]): SplitBoundary[] {
  const found = outline
    .filter((item): item is PdfOutlineItem & { pageNumber: number } => item.pageNumber !== null)
    .map((item) => ({ title: item.title, pageNumber: item.pageNumber }));

  return found.sort((a, b) => a.pageNumber - b.pageNumber);
}
