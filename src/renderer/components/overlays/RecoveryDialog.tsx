import { useState, type ReactElement } from 'react';
import { RotateCcw, Save } from 'lucide-react';
import type { OpenResult, RecoveryEntry } from '@shared/schemas/document';
import { AppError } from '@shared/errors/appError';
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

/** What one entry says about its state, in words rather than colour. */
function describe(entry: RecoveryEntry): string {
  const parts = [`Open ${formatRelativeTime(entry.lastTouchedAt)}`];
  if (entry.unsavedChanges) parts.push('unsaved changes kept');
  else if (entry.dirty) parts.push('had unsaved changes that could not be kept');
  if (!entry.fileStillExists) parts.push('file no longer found');
  return parts.join(' · ');
}

/**
 * Shown at startup when a previous run left document sessions behind, which
 * only happens after a crash. PaperForge never changed the files themselves.
 * Reopening opens them again and puts back any unsaved changes PaperForge kept
 * — still unsaved, so the reader decides whether to keep them. A document
 * whose file has gone can have its kept changes saved somewhere new.
 */
export function RecoveryDialog({ entries, onDone }: RecoveryDialogProps): ReactElement {
  const [busy, setBusy] = useState(false);
  const [remaining, setRemaining] = useState<readonly RecoveryEntry[]>(entries);
  const openPaths = useDocumentStore((state) => state.openPaths);
  const receiveEdit = useDocumentStore((state) => state.receiveEdit);
  const showToast = useUiStore((state) => state.showToast);

  const restorable = remaining.filter((entry) => entry.fileStillExists);
  // Missing files with nothing kept hold nothing worth offering again.
  const empty = remaining.filter((entry) => !entry.fileStillExists && !entry.unsavedChanges);
  const stranded = remaining.filter((entry) => !entry.fileStillExists && entry.unsavedChanges);

  /** Puts reopened documents into tabs, with the edit state the main process now holds. */
  const adopt = async (result: OpenResult): Promise<void> => {
    await openPaths(result.sessions.map((session) => session.file.path));
    for (const session of result.sessions) {
      receiveEdit(await invoke('edit:state', { sessionId: session.id }));
    }
    for (const failure of result.failures) {
      showToast({ title: failure.message, description: failure.details, intent: 'error' });
    }
  };

  const reportError = (error: unknown): void => {
    const serialized = AppError.serialize(error);
    showToast({ title: serialized.message, description: serialized.details, intent: 'error' });
  };

  const discardAll = async (): Promise<void> => {
    setBusy(true);
    try {
      await invoke('recovery:discard', { sessionIds: remaining.map((entry) => entry.sessionId) });
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(false);
      onDone();
    }
  };

  const reopen = async (): Promise<void> => {
    setBusy(true);
    try {
      if (restorable.length > 0) {
        await adopt(
          await invoke('recovery:restore', {
            sessionIds: restorable.map((entry) => entry.sessionId),
          }),
        );
      }
      if (empty.length > 0) {
        await invoke('recovery:discard', { sessionIds: empty.map((entry) => entry.sessionId) });
      }
      if (stranded.length > 0) {
        showToast({
          title: `Unsaved changes to ${stranded.length} missing file${stranded.length === 1 ? ' were' : 's were'} kept.`,
          description: 'PaperForge will offer them again next time it starts.',
          intent: 'warning',
        });
      }
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(false);
      onDone();
    }
  };

  const saveCopy = async (entry: RecoveryEntry): Promise<void> => {
    setBusy(true);
    try {
      const result = await invoke('recovery:saveCopy', {
        sessionId: entry.sessionId,
        displayName: entry.displayName,
      });
      if (result.canceled) return;
      await adopt(result);
      if (result.sessions.length > 0) {
        const next = remaining.filter((candidate) => candidate.sessionId !== entry.sessionId);
        setRemaining(next);
        if (next.length === 0) onDone();
      }
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(false);
    }
  };

  const reopenLabel =
    restorable.length === remaining.length
      ? 'Reopen all'
      : `Reopen ${restorable.length} of ${remaining.length}`;

  return (
    <Dialog
      title="Recover documents"
      description="PaperForge did not close normally last time."
      onClose={onDone}
      footer={
        <>
          <Button disabled={busy} onClick={() => void discardAll()}>
            Discard
          </Button>
          <Button
            appearance="primary"
            icon={RotateCcw}
            disabled={busy || (restorable.length === 0 && empty.length === 0)}
            onClick={() => void reopen()}
          >
            {restorable.length === 0 ? 'Close' : reopenLabel}
          </Button>
        </>
      }
    >
      <p className={styles.intro}>
        These documents were open at the time. Your files were not modified. Where PaperForge kept
        unsaved changes, reopening puts them back — still unsaved, and Undo returns to the file as
        it is on disk.
      </p>
      <ul className={styles.list}>
        {remaining.map((entry) => (
          <li key={entry.sessionId} className={styles.entry}>
            <span className={styles.name}>{entry.displayName}</span>
            <span className={styles.path}>{entry.path}</span>
            <span className={styles.meta}>{describe(entry)}</span>
            {!entry.fileStillExists && entry.unsavedChanges && (
              <span className={styles.actions}>
                <Button icon={Save} disabled={busy} onClick={() => void saveCopy(entry)}>
                  Save changes as…
                </Button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
