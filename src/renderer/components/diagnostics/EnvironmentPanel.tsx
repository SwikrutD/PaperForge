import { useState, type ReactElement } from 'react';
import { ClipboardCheck, ClipboardCopy } from 'lucide-react';
import type { AppInfo } from '@shared/schemas/appInfo';
import { Button } from '../controls/Button';
import styles from './EnvironmentPanel.module.css';

interface EnvironmentPanelProps {
  info: AppInfo;
}

function diagnosticLines(info: AppInfo): Array<[string, string]> {
  return [
    ['Version', info.version],
    ['Build', info.isPackaged ? 'Packaged' : 'Development'],
    ['Electron', info.versions.electron],
    ['Chromium', info.versions.chrome],
    ['Node', info.versions.node],
    ['Platform', `${info.platform} ${info.arch}`],
    ['Locale', info.locale],
    ['Settings folder', info.paths.userData],
    ['Log folder', info.paths.logs],
  ];
}

/** Local environment facts, plus a copyable block for bug reports. */
export function EnvironmentPanel({ info }: EnvironmentPanelProps): ReactElement {
  const [copied, setCopied] = useState(false);
  const rows = diagnosticLines(info);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(
        rows.map(([key, value]) => `${key}: ${value}`).join('\n'),
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div>
      <dl className={styles.list}>
        {rows.map(([key, value]) => (
          <div key={key} style={{ display: 'contents' }}>
            <dt className={styles.term}>{key}</dt>
            <dd className={styles.value}>{value}</dd>
          </div>
        ))}
      </dl>
      <div className={styles.footer}>
        <Button
          icon={copied ? ClipboardCheck : ClipboardCopy}
          onClick={() => {
            void copy();
          }}
        >
          {copied ? 'Copied' : 'Copy diagnostics'}
        </Button>
        <span className={styles.note}>Stays on this computer.</span>
      </div>
    </div>
  );
}
