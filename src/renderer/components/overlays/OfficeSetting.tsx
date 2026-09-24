import { useEffect, useState, type ReactElement } from 'react';
import type { OfficeStatus } from '@shared/schemas/convert';
import { AppError } from '@shared/errors/appError';
import { invoke } from '../../services/ipcClient';
import { useUiStore } from '../../stores/uiStore';
import { Button } from '../controls/Button';
import styles from './SettingsDialog.module.css';

const UNREADABLE: OfficeStatus = {
  available: false,
  path: null,
  version: null,
  problem: 'LibreOffice could not be asked about itself.',
};

/**
 * Whether a local LibreOffice is there for Office documents.
 *
 * PaperForge does not ship it and never downloads it: without it, Office
 * files are refused with a reason, and everything else carries on working.
 */
export function OfficeSetting(): ReactElement {
  const showToast = useUiStore((state) => state.showToast);
  const [status, setStatus] = useState<OfficeStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void invoke('convert:officeStatus')
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
      setStatus(await invoke('convert:locateOffice', clear ? { clear: true } : {}));
    } catch (error) {
      const serialized = AppError.serialize(error);
      showToast({ title: serialized.message, description: serialized.details, intent: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const description =
    status === null
      ? 'Looking for LibreOffice…'
      : status.available
        ? `${status.version ?? 'Installed'} · ${status.path ?? ''}`
        : (status.problem ?? 'LibreOffice was not found.');

  return (
    <div className={styles.row}>
      <div className={styles.rowText}>
        <p className={styles.rowLabel}>LibreOffice</p>
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
