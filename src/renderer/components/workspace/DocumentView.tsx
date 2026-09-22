import type { ReactElement } from 'react';
import { AlertTriangle, FolderOpen, Info, Lock, X } from 'lucide-react';
import type { DocumentTab } from '../../stores/documentStore';
import { useDocumentStore } from '../../stores/documentStore';
import { useCommands } from '../../commands/useCommands';
import { formatBytes } from '../../utils/format';
import { formatRelativeTime } from '../../utils/time';
import { Button } from '../controls/Button';
import styles from './DocumentView.module.css';

/**
 * What PaperForge can show about an open document today: the facts it read
 * from the file itself. Page rendering arrives with the viewer in Segment 3,
 * and this view says so rather than showing an empty page area.
 */
export function DocumentView({ tab }: { tab: DocumentTab }): ReactElement {
  const { execute } = useCommands();
  const dismissChange = useDocumentStore((state) => state.dismissChange);
  const close = useDocumentStore((state) => state.close);
  const { file, openedAt } = tab.session;

  const facts: Array<[string, string]> = [
    ['Location', file.path],
    ['Size', formatBytes(file.sizeBytes)],
    [
      'Last modified',
      `${formatRelativeTime(file.modifiedAt)} (${new Date(file.modifiedAt).toLocaleString()})`,
    ],
    ['PDF version', file.pdfVersion === null ? 'Not stated in the header' : file.pdfVersion],
    ['Opened', formatRelativeTime(openedAt)],
  ];

  return (
    <article className={styles.view} aria-label={file.displayName}>
      <header className={styles.header}>
        <h1 className={styles.title}>{file.displayName}</h1>
        <div className={styles.badges}>
          {file.readOnly && <span className={styles.badge}>Read-only file</span>}
          {file.encryptionDetected && (
            <span className={styles.badge}>
              <Lock className={styles.badgeIcon} aria-hidden="true" strokeWidth={2} />
              Password protected
            </span>
          )}
        </div>
      </header>

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
                : 'The details below were refreshed from the file on disk.'}
            </p>
          </div>
          <Button onClick={() => dismissChange(tab.session.id)}>Dismiss</Button>
        </div>
      )}

      <dl className={styles.facts}>
        {facts.map(([label, value]) => (
          <div key={label} className={styles.fact}>
            <dt className={styles.factTerm}>{label}</dt>
            <dd className={styles.factValue}>{value}</dd>
          </div>
        ))}
      </dl>

      <p className={styles.note}>
        <Info className={styles.noteIcon} aria-hidden="true" strokeWidth={1.75} />
        <span>
          The document is open and PaperForge is watching it for outside changes. Page rendering,
          text selection and search arrive with the viewer; nothing here modifies the file.
        </span>
      </p>

      <div className={styles.actions}>
        <Button icon={FolderOpen} onClick={() => execute('file.revealInExplorer')}>
          Show in Explorer
        </Button>
        <Button icon={X} onClick={() => void close(tab.session.id)}>
          Close document
        </Button>
      </div>
    </article>
  );
}
