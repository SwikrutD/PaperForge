import type { ReactElement } from 'react';
import type { AppStatus } from '../../stores/appStore';
import { useJobStore } from '../../stores/jobStore';
import { isJobActive } from '../../types/jobs';
import { cx } from '../../utils/classNames';
import styles from './StatusBar.module.css';

interface StatusBarProps {
  status: AppStatus;
  /** Shown only while PaperForge is starting, or when starting went wrong. */
  statusText: string;
  /** The active document, as short facts (see `describeDocument`). */
  documentText: readonly string[];
  /** Page, zoom and rotation of the open document, when there is one. */
  viewText: string | null;
}

/**
 * The strip along the foot of the window: the document in front of the reader
 * and where they are in it. Startup status appears only while it is news.
 */
export function StatusBar({
  status,
  statusText,
  documentText,
  viewText,
}: StatusBarProps): ReactElement {
  const activeJobs = useJobStore((state) => state.jobs.filter(isJobActive).length);

  return (
    <footer className={styles.bar} data-focus-region="statusBar" tabIndex={-1}>
      <div className={styles.group}>
        {status !== 'ready' && (
          <>
            {/* Status is never signalled by colour alone. */}
            <span
              className={cx(styles.dot, status === 'error' ? styles.dotError : styles.dotBusy)}
              aria-hidden="true"
            />
            <span className={styles.item}>{statusText}</span>
          </>
        )}
        {documentText.map((part, index) => (
          <span
            key={`${String(index)}:${part}`}
            className={cx(styles.item, index === 0 && styles.primary)}
          >
            {part}
          </span>
        ))}
        {activeJobs > 0 && (
          <span
            className={styles.item}
          >{`${activeJobs} background task${activeJobs === 1 ? '' : 's'}`}</span>
        )}
      </div>
      {viewText !== null && (
        <div className={styles.group}>
          <span className={styles.item}>{viewText}</span>
        </div>
      )}
    </footer>
  );
}
