import { useState, type ReactElement } from 'react';
import { Clock, FileText, Pin, PinOff, X } from 'lucide-react';
import type { RecentFileEntry } from '@shared/schemas/recentFiles';
import { useAppStore } from '../../stores/appStore';
import { useDocumentStore } from '../../stores/documentStore';
import { formatBytes } from '../../utils/format';
import { formatRelativeTime } from '../../utils/time';
import { IconButton } from '../controls/IconButton';
import { ContextMenu, type ContextMenuItem } from '../controls/ContextMenu';
import { EmptyPanelState } from '../panels/EmptyPanelState';
import styles from './RecentFilesList.module.css';

/**
 * Recent and pinned files from the local store, pinned first. A row opens the
 * document; the context menu covers pinning, removing and Explorer.
 */
export function RecentFilesList({
  entries,
}: {
  entries: readonly RecentFileEntry[];
}): ReactElement {
  const openPaths = useDocumentStore((state) => state.openPaths);
  const setPinned = useAppStore((state) => state.setRecentFilePinned);
  const removeRecent = useAppStore((state) => state.removeRecentFile);
  const revealInExplorer = useAppStore((state) => state.revealInExplorer);
  const [menu, setMenu] = useState<{ entry: RecentFileEntry; x: number; y: number } | null>(null);

  if (entries.length === 0) {
    return (
      <EmptyPanelState
        icon={Clock}
        title="No recent files"
        description="Files you open are listed here, on this computer only."
      />
    );
  }

  const menuItems = (entry: RecentFileEntry): ContextMenuItem[] => [
    { id: 'open', label: 'Open', onSelect: () => void openPaths([entry.path]) },
    {
      id: 'reveal',
      label: 'Show in Explorer',
      onSelect: () => void revealInExplorer(entry.path),
    },
    {
      id: 'pin',
      label: entry.pinned ? 'Unpin' : 'Pin to top',
      group: 'list',
      onSelect: () => void setPinned(entry.path, !entry.pinned),
    },
    {
      id: 'remove',
      label: 'Remove from list',
      group: 'list',
      onSelect: () => void removeRecent(entry.path),
    },
  ];

  return (
    <>
      <ul className={styles.list}>
        {entries.map((entry) => (
          <li
            key={entry.path}
            className={styles.row}
            onContextMenu={(event) => {
              event.preventDefault();
              setMenu({ entry, x: event.clientX, y: event.clientY });
            }}
          >
            <button
              type="button"
              className={styles.open}
              aria-label={`Open ${entry.displayName}`}
              title={entry.path}
              onClick={() => void openPaths([entry.path])}
            >
              <FileText className={styles.icon} aria-hidden="true" strokeWidth={1.6} />
              <span className={styles.text}>
                <span className={styles.name}>
                  {entry.displayName}
                  {entry.pinned && (
                    <Pin className={styles.pin} aria-label="Pinned" strokeWidth={2} />
                  )}
                </span>
                <span className={styles.path}>{entry.path}</span>
              </span>
              <span className={styles.meta}>
                {entry.sizeBytes === undefined ? '' : `${formatBytes(entry.sizeBytes)} · `}
                {formatRelativeTime(entry.lastOpenedAt)}
              </span>
            </button>

            <span className={styles.actions}>
              <IconButton
                icon={entry.pinned ? PinOff : Pin}
                size="small"
                label={entry.pinned ? `Unpin ${entry.displayName}` : `Pin ${entry.displayName}`}
                onClick={() => void setPinned(entry.path, !entry.pinned)}
              />
              <IconButton
                icon={X}
                size="small"
                label={`Remove ${entry.displayName} from the list`}
                onClick={() => void removeRecent(entry.path)}
              />
            </span>
          </li>
        ))}
      </ul>

      {menu !== null && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label={menu.entry.displayName}
          items={menuItems(menu.entry)}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}
