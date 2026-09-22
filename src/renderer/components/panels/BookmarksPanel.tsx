import { useState, type ReactElement } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { PdfOutlineItem } from '@pdf/render/types';
import { useDocumentStore } from '../../stores/documentStore';
import { cx } from '../../utils/classNames';
import styles from './BookmarksPanel.module.css';

interface BookmarksPanelProps {
  outline: readonly PdfOutlineItem[];
  sessionId: string;
}

/**
 * The document outline as its author wrote it, including bold, italic and
 * colour. Entries that point nowhere PaperForge can follow are shown but not
 * clickable, rather than silently doing nothing.
 */
export function BookmarksPanel({ outline, sessionId }: BookmarksPanelProps): ReactElement {
  return (
    <ul className={styles.list}>
      {outline.map((item) => (
        <BookmarkNode key={item.id} item={item} sessionId={sessionId} depth={0} />
      ))}
    </ul>
  );
}

function BookmarkNode({
  item,
  sessionId,
  depth,
}: {
  item: PdfOutlineItem;
  sessionId: string;
  depth: number;
}): ReactElement {
  const updateView = useDocumentStore((state) => state.updateView);
  const [expanded, setExpanded] = useState(depth === 0);
  const hasChildren = item.children.length > 0;
  const target = item.pageNumber;

  return (
    <li className={styles.node}>
      <div className={styles.row} style={{ paddingLeft: `${depth * 14}px` }}>
        {hasChildren ? (
          <button
            type="button"
            className={styles.twisty}
            aria-expanded={expanded}
            aria-label={expanded ? `Collapse ${item.title}` : `Expand ${item.title}`}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? (
              <ChevronDown className={styles.twistyIcon} strokeWidth={2} />
            ) : (
              <ChevronRight className={styles.twistyIcon} strokeWidth={2} />
            )}
          </button>
        ) : (
          <span className={styles.twistySpacer} />
        )}

        <button
          type="button"
          className={cx(styles.title, target === null && styles.inert)}
          style={{
            ...(item.color === null ? {} : { color: item.color }),
            fontWeight: item.bold ? 'var(--pf-font-weight-medium)' : undefined,
            fontStyle: item.italic ? 'italic' : undefined,
          }}
          disabled={target === null}
          title={target === null ? 'This bookmark has no page to go to.' : `Go to page ${target}`}
          onClick={() => {
            if (target !== null) updateView(sessionId, { pendingPage: target });
          }}
        >
          {item.title === '' ? '(untitled)' : item.title}
        </button>

        {target !== null && <span className={styles.page}>{target}</span>}
      </div>

      {hasChildren && expanded && (
        <ul className={styles.list}>
          {item.children.map((child) => (
            <BookmarkNode key={child.id} item={child} sessionId={sessionId} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}
