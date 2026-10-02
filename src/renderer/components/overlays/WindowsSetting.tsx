import { useEffect, useState, type ReactElement } from 'react';
import type { FileAssociationStatus } from '@shared/schemas/system';
import { AppError } from '@shared/errors/appError';
import { invoke } from '../../services/ipcClient';
import { useUiStore } from '../../stores/uiStore';
import { Button } from '../controls/Button';
import { Toggle } from '../controls/Toggle';
import styles from './SettingsDialog.module.css';

/**
 * PDF files and Windows: whether PaperForge is in the Open With list, and the
 * way to make it the default. Windows keeps that last choice for the reader
 * to make in its own Settings, so PaperForge opens the page rather than
 * pretending to make it.
 */
export function WindowsSetting(): ReactElement {
  const showToast = useUiStore((state) => state.showToast);
  const [status, setStatus] = useState<FileAssociationStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void invoke('system:fileAssociation')
      .then((result) => {
        if (!cancelled) setStatus(result);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const run = async (work: () => Promise<FileAssociationStatus | null>): Promise<void> => {
    setBusy(true);
    try {
      const next = await work();
      if (next !== null) setStatus(next);
    } catch (error) {
      const serialized = AppError.serialize(error);
      showToast({ title: serialized.message, description: serialized.details, intent: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const supported = status?.supported === true;
  const description =
    status === null
      ? 'Asking Windows…'
      : !status.supported
        ? (status.problem ?? 'Not available in this copy of PaperForge.')
        : status.isDefault
          ? 'PDF files open in PaperForge.'
          : status.openWith
            ? 'PaperForge is in the Open With list for PDF files.'
            : 'PaperForge is not offered for PDF files.';

  return (
    <>
      <div className={styles.row}>
        <div className={styles.rowText}>
          <p className={styles.rowLabel}>Offer for PDF files</p>
          <p className={styles.rowDescription}>{description}</p>
        </div>
        <div className={styles.rowControl}>
          <Toggle
            checked={status?.openWith === true}
            disabled={!supported || busy}
            label={status?.openWith === true ? 'On' : 'Off'}
            onChange={(checked) =>
              void run(() => invoke('system:setOpenWith', { enabled: checked }))
            }
          />
        </div>
      </div>
      <div className={styles.row}>
        <div className={styles.rowText}>
          <p className={styles.rowLabel}>Default PDF app</p>
          <p className={styles.rowDescription}>
            Windows asks you to choose this yourself, in Settings → Default apps.
          </p>
        </div>
        <div className={styles.rowControl}>
          <Button
            disabled={!supported || busy || status?.openWith !== true}
            onClick={() =>
              void run(async () => {
                await invoke('system:openDefaultApps');
                return null;
              })
            }
          >
            Open Windows Settings
          </Button>
        </div>
      </div>
    </>
  );
}
