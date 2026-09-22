import { useEffect, useState, type ReactElement } from 'react';
import { Bookmark, Layers, Paperclip, StickyNote, X } from 'lucide-react';
import type {
  LoadedPdfDocument,
  PdfAttachment,
  PdfLayer,
  PdfOutlineItem,
} from '@pdf/render/types';
import type { LeftPanelId } from '@shared/schemas/settings';
import { useCommands } from '../../commands/useCommands';
import { IconButton } from '../controls/IconButton';
import { usePdfDocumentContext } from '../viewer/pdfDocumentContextValue';
import { AttachmentsPanel } from './AttachmentsPanel';
import { BookmarksPanel } from './BookmarksPanel';
import { EmptyPanelState } from './EmptyPanelState';
import { LayersPanel } from './LayersPanel';
import { PagesPanel } from './PagesPanel';
import styles from './LeftPanel.module.css';

const PANELS: Record<LeftPanelId, { title: string; icon: typeof Bookmark }> = {
  pages: { title: 'Page Thumbnails', icon: StickyNote },
  bookmarks: { title: 'Bookmarks', icon: Bookmark },
  attachments: { title: 'Attachments', icon: Paperclip },
  layers: { title: 'Layers', icon: Layers },
};

/** The contextual left panel. Its content is chosen by the rail. */
export function LeftPanel({ panel }: { panel: LeftPanelId }): ReactElement {
  const { execute } = useCommands();
  const model = PANELS[panel];

  return (
    <section
      className={styles.panel}
      aria-label={model.title}
      data-focus-region="leftPanel"
      tabIndex={-1}
    >
      <header className={styles.header}>
        <h2 className={styles.title}>{model.title}</h2>
        <IconButton
          icon={X}
          label="Close panel"
          size="small"
          onClick={() => execute('view.toggleLeftPanel')}
        />
      </header>
      <div className={styles.body}>
        <PanelBody panel={panel} />
      </div>
    </section>
  );
}

interface PanelData {
  /** The document this data was read from, so stale data is never shown. */
  source: LoadedPdfDocument;
  outline: PdfOutlineItem[];
  attachments: PdfAttachment[];
  layers: PdfLayer[];
}

function PanelBody({ panel }: { panel: LeftPanelId }): ReactElement {
  const { document: pdf, tab, status, layersVersion, setLayerVisible } = usePdfDocumentContext();
  const [loaded, setLoaded] = useState<PanelData | null>(null);

  // Data from a previous document is ignored rather than cleared, which keeps
  // the switch to another tab free of an extra render pass.
  const data = loaded !== null && loaded.source === pdf ? loaded : null;

  // Each panel reads what it needs, once per document.
  useEffect(() => {
    if (pdf === null) return;
    let cancelled = false;

    void Promise.all([pdf.getOutline(), pdf.getAttachments(), pdf.getLayers()]).then(
      ([outline, attachments, layers]) => {
        if (!cancelled) setLoaded({ source: pdf, outline, attachments, layers });
      },
      () => {
        if (!cancelled) setLoaded({ source: pdf, outline: [], attachments: [], layers: [] });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [pdf]);

  // Layer visibility lives on the document, so re-read it after a toggle.
  useEffect(() => {
    if (pdf === null || layersVersion === 0) return;
    let cancelled = false;
    void pdf.getLayers().then((layers) => {
      if (!cancelled) {
        setLoaded((current) => (current === null ? current : { ...current, layers }));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [pdf, layersVersion]);

  if (tab === null) {
    return (
      <EmptyPanelState
        icon={PANELS[panel].icon}
        title="No document open"
        description="Open a PDF to see its pages, bookmarks, attachments and layers."
      />
    );
  }

  if (pdf === null || status !== 'ready') {
    return (
      <EmptyPanelState
        icon={PANELS[panel].icon}
        title={status === 'error' ? 'The document could not be read' : 'Opening the document…'}
        description={
          status === 'error'
            ? 'The workspace explains what went wrong.'
            : 'This panel fills in once the document is open.'
        }
      />
    );
  }

  if (panel === 'pages') {
    return (
      <PagesPanel document={pdf} sessionId={tab.session.id} currentPage={tab.view.pageNumber} />
    );
  }

  if (panel === 'bookmarks') {
    if (data === null) return <PanelLoading />;
    return data.outline.length === 0 ? (
      <EmptyPanelState
        icon={Bookmark}
        title="No bookmarks"
        description="This document does not define an outline."
      />
    ) : (
      <BookmarksPanel outline={data.outline} sessionId={tab.session.id} />
    );
  }

  if (panel === 'attachments') {
    if (data === null) return <PanelLoading />;
    return data.attachments.length === 0 ? (
      <EmptyPanelState
        icon={Paperclip}
        title="No attachments"
        description="This document carries no embedded files."
      />
    ) : (
      <AttachmentsPanel attachments={data.attachments} />
    );
  }

  if (data === null) return <PanelLoading />;
  return data.layers.length === 0 ? (
    <EmptyPanelState
      icon={Layers}
      title="No layers"
      description="This document defines no optional content groups."
    />
  ) : (
    <LayersPanel layers={data.layers} onToggle={setLayerVisible} />
  );
}

function PanelLoading(): ReactElement {
  return <p className={styles.loading}>Reading the document…</p>;
}
