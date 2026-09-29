import { useEffect, type ReactElement } from 'react';
import { AlertTriangle, FileText, FolderOpen, Lock } from 'lucide-react';
import type { DocumentTab } from '../../stores/documentStore';
import { useDocumentStore } from '../../stores/documentStore';
import { useAdminStore } from '../../stores/adminStore';
import { useCommands } from '../../commands/useCommands';
import { formatBytes } from '../../utils/format';
import { formatRelativeTime } from '../../utils/time';
import { Button } from '../controls/Button';
import styles from './DocumentProperties.module.css';

/**
 * What PaperForge knows about the open file, shown in the properties panel.
 *
 * The security badge comes from the document's own encryption dictionary, not
 * from a scan of the trailer, so it says which kind of protection a document
 * carries rather than only that the word appears in the file.
 */
export function DocumentProperties({ tab }: { tab: DocumentTab }): ReactElement {
  const { execute } = useCommands();
  const dismissChange = useDocumentStore((state) => state.dismissChange);
  const properties = useAdminStore((state) => state.properties);
  const loadedFor = useAdminStore((state) => state.propertiesFor);
  const load = useAdminStore((state) => state.loadProperties);
  const { file, openedAt } = tab.session;

  const sessionId = tab.session.id;
  const revision = tab.edit.revision;

  useEffect(() => {
    void load(sessionId, revision);
  }, [load, sessionId, revision]);

  const read =
    properties !== null && loadedFor?.sessionId === sessionId && loadedFor.revision === revision
      ? properties
      : null;
  const security = read?.security ?? null;

  const facts: Array<[string, string]> = [
    ['Title', read?.metadata.title ?? (read === null ? '…' : 'Not stated')],
    ['Author', read?.metadata.author ?? (read === null ? '…' : 'Not stated')],
    ['Location', file.path],
    ['Size', formatBytes(file.sizeBytes)],
    ['Modified', `${formatRelativeTime(file.modifiedAt)}`],
    ['PDF version', file.pdfVersion === null ? 'Not stated' : file.pdfVersion],
    ['Opened', formatRelativeTime(openedAt)],
  ];

  // Before the summary arrives the trailer scan is all there is; it is the
  // same thing the file list uses and it is never wrong about "not encrypted".
  const encrypted = security === null ? file.encryptionDetected : security.encrypted;
  const securityLabel =
    security === null
      ? 'Password protected'
      : security.openPasswordRequired === true
        ? 'Password to open'
        : 'Restricted';

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
        {encrypted && (
          <span className={styles.badge}>
            <Lock className={styles.badgeIcon} aria-hidden="true" strokeWidth={2} />
            {securityLabel}
          </span>
        )}
        {read?.tagged === true && <span className={styles.badge}>Tagged PDF</span>}
      </div>

      <dl className={styles.facts}>
        {facts.map(([label, value]) => (
          <div key={label} className={styles.fact}>
            <dt className={styles.factTerm}>{label}</dt>
            <dd className={styles.factValue}>{value}</dd>
          </div>
        ))}
      </dl>

      <Button icon={FileText} onClick={() => execute('tools.properties')}>
        Document Properties
      </Button>
      <Button icon={FolderOpen} onClick={() => execute('file.revealInExplorer')}>
        Show in Explorer
      </Button>
    </div>
  );
}
