import { useEffect, useState, type ReactElement } from 'react';
import type { QpdfStatus } from '@shared/schemas/edit';
import { AppError } from '@shared/errors/appError';
import { invoke } from '../../services/ipcClient';
import { useUiStore } from '../../stores/uiStore';
import { Button } from '../controls/Button';
import styles from './SettingsDialog.module.css';

const UNREADABLE: QpdfStatus = {
  available: false,
  path: null,
  version: null,
  problem: 'qpdf could not be asked about itself.',
};

/**
 * Whether the optional qpdf sidecar is usable, and how to point PaperForge at
 * one. PaperForge validates everything it saves by reopening it; qpdf is a
 * second opinion, so this says plainly that not having it costs a check
 * rather than breaking anything.
 */
export function QpdfSetting(): ReactElement {
  const showToast = useUiStore((state) => state.showToast);
  const [status, setStatus] = useState<QpdfStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void invoke('tools:qpdfStatus')
      .then((result) => {
        if (!cancelled) setStatus(result);
      })
      .catch(() => {
        if (!cancelled) setStatus(UNREADABLE);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const locate = async (clear: boolean): Promise<void> => {
    setBusy(true);
    try {
      setStatus(await invoke('tools:locateQpdf', clear ? { clear: true } : {}));
    } catch (error) {
      const serialized = AppError.serialize(error);
      showToast({ title: serialized.message, description: serialized.details, intent: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const description =
    status === null
      ? 'Looking for qpdf…'
      : status.available
        ? `${status.version ?? 'Installed'} · ${status.path ?? ''}`
        : (status.problem ?? 'qpdf was not found.');

  return (
    <div className={styles.row}>
      <div className={styles.rowText}>
        <p className={styles.rowLabel}>qpdf</p>
        <p className={styles.rowDescription}>{description}</p>
      </div>
      <div className={styles.rowControl}>
        <Button disabled={busy} onClick={() => void locate(false)}>
          Locate…
        </Button>
        {status !== null && status.path !== null && (
          <Button disabled={busy} onClick={() => void locate(true)}>
            Use automatic
          </Button>
        )}
      </div>
    </div>
  );
}
