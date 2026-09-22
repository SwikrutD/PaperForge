import type { ReactElement } from 'react';
import { Clock, FileText, Pin } from 'lucide-react';
import type { RecentFileEntry } from '@shared/schemas/recentFiles';
import { formatRelativeTime } from '../../utils/time';
import { EmptyPanelState } from '../panels/EmptyPanelState';
import styles from './RecentFilesList.module.css';

/**
 * Recent and pinned files from the local store, pinned first. Entries are
 * listed for reference only until the viewer can open them, so a row is not
 * presented as a clickable action.
 */
export function RecentFilesList({
  entries,
}: {
  entries: readonly RecentFileEntry[];
}): ReactElement {
  if (entries.length === 0) {
    return (
      <EmptyPanelState
        icon={Clock}
        title="No recent files"
        description="Files you open are listed here, on this computer only."
      />
    );
  }

  return (
    <ul className={styles.list}>
      {entries.map((entry) => (
        <li key={entry.path} className={styles.row}>
          <FileText className={styles.icon} aria-hidden="true" strokeWidth={1.6} />
          <span className={styles.text}>
            <span className={styles.name}>
              {entry.displayName}
              {entry.pinned && <Pin className={styles.pin} aria-label="Pinned" strokeWidth={2} />}
            </span>
            <span className={styles.path}>{entry.path}</span>
          </span>
          <span className={styles.time}>{formatRelativeTime(entry.lastOpenedAt)}</span>
        </li>
      ))}
    </ul>
  );
}
