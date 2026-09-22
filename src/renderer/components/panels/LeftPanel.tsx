import type { ReactElement } from 'react';
import { Bookmark, Layers, Paperclip, StickyNote, X } from 'lucide-react';
import type { LeftPanelId } from '@shared/schemas/settings';
import { useCommands } from '../../commands/useCommands';
import { IconButton } from '../controls/IconButton';
import { EmptyPanelState } from './EmptyPanelState';
import styles from './LeftPanel.module.css';

const PANELS: Record<
  LeftPanelId,
  { title: string; icon: typeof Bookmark; empty: { title: string; description: string } }
> = {
  pages: {
    title: 'Page Thumbnails',
    icon: StickyNote,
    empty: {
      title: 'No pages to show',
      description: 'Page thumbnails appear here once a document is open.',
    },
  },
  bookmarks: {
    title: 'Bookmarks',
    icon: Bookmark,
    empty: {
      title: 'No bookmarks to show',
      description: "A document's outline appears here when it has one.",
    },
  },
  attachments: {
    title: 'Attachments',
    icon: Paperclip,
    empty: {
      title: 'No attachments to show',
      description:
        'Files embedded in a document are listed here. PaperForge never opens them on its own.',
    },
  },
  layers: {
    title: 'Layers',
    icon: Layers,
    empty: {
      title: 'No layers to show',
      description: 'Optional content groups appear here for documents that define them.',
    },
  },
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
        <EmptyPanelState
          icon={model.icon}
          title={model.empty.title}
          description={model.empty.description}
        />
      </div>
    </section>
  );
}
