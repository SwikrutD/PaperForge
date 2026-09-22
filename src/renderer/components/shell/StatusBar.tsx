import type { ReactElement } from 'react';
import type { AppStatus } from '../../stores/appStore';
import { useJobStore } from '../../stores/jobStore';
import { isJobActive } from '../../types/jobs';
import { cx } from '../../utils/classNames';
import styles from './StatusBar.module.css';

interface StatusBarProps {
  status: AppStatus;
  statusText: string;
  documentText: string;
  themeText: string;
}

const dotClassFor = (status: AppStatus): string => {
  if (status === 'error') return cx(styles.dot, styles.dotError);
  if (status === 'ready') return cx(styles.dot);
  return cx(styles.dot, styles.dotBusy);
};

export function StatusBar({
  status,
  statusText,
  documentText,
  themeText,
}: StatusBarProps): ReactElement {
  const activeJobs = useJobStore((state) => state.jobs.filter(isJobActive).length);

  return (
    <footer className={styles.bar} data-focus-region="statusBar" tabIndex={-1}>
      <div className={styles.group}>
        {/* Status is never signalled by colour alone. */}
        <span className={dotClassFor(status)} aria-hidden="true" />
        <span className={styles.item}>{statusText}</span>
        {activeJobs > 0 && (
          <span
            className={styles.item}
          >{`${activeJobs} background task${activeJobs === 1 ? '' : 's'}`}</span>
        )}
      </div>
      <div className={styles.group}>
        <span className={styles.item}>{documentText}</span>
        <span className={styles.item}>{themeText}</span>
      </div>
    </footer>
  );
}
