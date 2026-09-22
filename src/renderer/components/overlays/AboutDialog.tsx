import type { ReactElement } from 'react';
import { ClipboardCopy } from 'lucide-react';
import type { AppInfo } from '@shared/schemas/appInfo';
import { APP_NAME } from '@shared/constants/app';
import { useCommands } from '../../commands/useCommands';
import { useUiStore } from '../../stores/uiStore';
import { diagnosticsRows } from '../../utils/diagnostics';
import { Button } from '../controls/Button';
import { LogoMark } from '../brand/LogoMark';
import { Dialog } from './Dialog';
import styles from './AboutDialog.module.css';

/** Version and environment facts, with the diagnostics block for bug reports. */
export function AboutDialog({ appInfo }: { appInfo: AppInfo | null }): ReactElement {
  const closeDialog = useUiStore((state) => state.closeDialog);
  const { execute, resolve } = useCommands();
  const copyCommand = resolve('help.copyDiagnostics');

  return (
    <Dialog
      title={`About ${APP_NAME}`}
      onClose={closeDialog}
      footer={
        <>
          <Button
            icon={ClipboardCopy}
            disabled={copyCommand?.enabled === false}
            title={copyCommand?.enabled === false ? copyCommand.reason : undefined}
            onClick={() => execute('help.copyDiagnostics')}
          >
            Copy diagnostics
          </Button>
          <Button appearance="primary" onClick={closeDialog}>
            Close
          </Button>
        </>
      }
    >
      <div className={styles.identity}>
        <LogoMark size={44} />
        <div>
          <p className={styles.name}>{APP_NAME}</p>
          <p className={styles.tagline}>An offline PDF workspace for Windows.</p>
        </div>
      </div>

      {appInfo === null ? (
        <p className={styles.loading}>Reading environment…</p>
      ) : (
        <dl className={styles.list}>
          {diagnosticsRows(appInfo).map(([key, value]) => (
            <div key={key} className={styles.entry}>
              <dt className={styles.term}>{key}</dt>
              <dd className={styles.value}>{value}</dd>
            </div>
          ))}
        </dl>
      )}

      <p className={styles.legal}>
        PaperForge is MIT licensed. Third-party components and their licenses are listed in
        THIRD_PARTY_NOTICES.md next to the application.
      </p>
    </Dialog>
  );
}
