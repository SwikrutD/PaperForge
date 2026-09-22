import type { ReactElement } from 'react';
import { AlertTriangle, FolderOpen, Lock } from 'lucide-react';
import type { DocumentTab } from '../../stores/documentStore';
import { useDocumentStore } from '../../stores/documentStore';
import { useCommands } from '../../commands/useCommands';
import { formatBytes } from '../../utils/format';
import { formatRelativeTime } from '../../utils/time';
import { Button } from '../controls/Button';
import styles from './DocumentProperties.module.css';

/**
 * What PaperForge knows about the open file, shown in the properties panel.
 * The full Document Properties dialog — metadata, fonts, security summary —
 * arrives with the document administration tools.
 */
export function DocumentProperties({ tab }: { tab: DocumentTab }): ReactElement {
  const { execute } = useCommands();
  const dismissChange = useDocumentStore((state) => state.dismissChange);
  const { file, openedAt } = tab.session;

  const facts: Array<[string, string]> = [
    ['Location', file.path],
    ['Size', formatBytes(file.sizeBytes)],
    ['Modified', `${formatRelativeTime(file.modifiedAt)}`],
    ['PDF version', file.pdfVersion === null ? 'Not stated' : file.pdfVersion],
    ['Opened', formatRelativeTime(openedAt)],
  ];

  return (
    <div className={styles.view}>
      {tab.externalChange !== null && (
        <div className={styles.alert} role="alert">
          <AlertTriangle className={styles.alertIcon} aria-hidden="true" strokeWidth={1.75} />
          <div className={styles.alertBody}>
            <p className={styles.alertTitle}>
              {tab.externalChange === 'deleted'
                ? 'This file is no longer at that location.'
                : 'This file changed outside PaperForge.'}
            </p>
            <p className={styles.alertText}>
              {tab.externalChange === 'deleted'
                ? 'It may have been moved, renamed or deleted. PaperForge has not altered it.'
                : 'Close and reopen the document to see the new version.'}
            </p>
          </div>
          <Button onClick={() => dismissChange(tab.session.id)}>Dismiss</Button>
        </div>
      )}

      <div className={styles.badges}>
        {file.readOnly && <span className={styles.badge}>Read-only file</span>}
        {file.encryptionDetected && (
          <span className={styles.badge}>
            <Lock className={styles.badgeIcon} aria-hidden="true" strokeWidth={2} />
            Password protected
          </span>
        )}
      </div>

      <dl className={styles.facts}>
        {facts.map(([label, value]) => (
          <div key={label} className={styles.fact}>
            <dt className={styles.factTerm}>{label}</dt>
            <dd className={styles.factValue}>{value}</dd>
          </div>
        ))}
      </dl>

      <Button icon={FolderOpen} onClick={() => execute('file.revealInExplorer')}>
        Show in Explorer
      </Button>
    </div>
  );
}
