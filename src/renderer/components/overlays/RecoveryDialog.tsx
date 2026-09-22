import { useState, type ReactElement } from 'react';
import { RotateCcw } from 'lucide-react';
import type { RecoveryEntry } from '@shared/schemas/document';
import { useDocumentStore } from '../../stores/documentStore';
import { useUiStore } from '../../stores/uiStore';
import { invoke } from '../../services/ipcClient';
import { formatRelativeTime } from '../../utils/time';
import { Button } from '../controls/Button';
import { Dialog } from './Dialog';
import styles from './RecoveryDialog.module.css';

interface RecoveryDialogProps {
  entries: readonly RecoveryEntry[];
  onDone: () => void;
}

/**
 * Shown at startup when a previous run left document sessions behind, which
 * only happens after a crash. PaperForge never changed the files themselves —
 * restoring reopens them, discarding forgets the leftover session data.
 */
export function RecoveryDialog({ entries, onDone }: RecoveryDialogProps): ReactElement {
  const [busy, setBusy] = useState(false);
  const openPaths = useDocumentStore((state) => state.openPaths);
  const showToast = useUiStore((state) => state.showToast);

  const restorable = entries.filter((entry) => entry.fileStillExists);
  const sessionIds = entries.map((entry) => entry.sessionId);

  const run = async (action: 'restore' | 'discard'): Promise<void> => {
    setBusy(true);
    try {
      if (action === 'discard') {
        await invoke('recovery:discard', { sessionIds });
      } else {
        const restorableIds = restorable.map((entry) => entry.sessionId);
        const result = await invoke('recovery:restore', { sessionIds: restorableIds });
        // Reuse the store's own merge path so tabs and toasts stay consistent.
        await openPaths(result.sessions.map((session) => session.file.path));
        const skipped = entries.length - restorable.length;
        if (skipped > 0) {
          showToast({
            title: `${skipped} file${skipped === 1 ? '' : 's'} could not be reopened.`,
            description: 'They are no longer at the location PaperForge recorded.',
            intent: 'warning',
          });
        }
      }
    } finally {
      setBusy(false);
      onDone();
    }
  };

  return (
    <Dialog
      title="Recover documents"
      description="PaperForge did not close normally last time."
      onClose={onDone}
      footer={
        <>
          <Button disabled={busy} onClick={() => void run('discard')}>
            Discard
          </Button>
          <Button
            appearance="primary"
            icon={RotateCcw}
            disabled={busy || restorable.length === 0}
            onClick={() => void run('restore')}
          >
            {restorable.length === entries.length
              ? 'Reopen all'
              : `Reopen ${restorable.length} of ${entries.length}`}
          </Button>
        </>
      }
    >
      <p className={styles.intro}>
        These documents were open at the time. Your files were not modified — PaperForge only kept a
        note of what was open.
      </p>
      <ul className={styles.list}>
        {entries.map((entry) => (
          <li key={entry.sessionId} className={styles.entry}>
            <span className={styles.name}>{entry.displayName}</span>
            <span className={styles.path}>{entry.path}</span>
            <span className={styles.meta}>
              {`Open ${formatRelativeTime(entry.lastTouchedAt)}`}
              {entry.dirty ? ' · had unsaved changes' : ''}
              {entry.fileStillExists ? '' : ' · file no longer found'}
            </span>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
