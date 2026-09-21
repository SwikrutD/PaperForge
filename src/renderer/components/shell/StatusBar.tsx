import type { ReactElement } from 'react';
import type { AppStatus } from '../../stores/appStore';
import styles from './StatusBar.module.css';
import { cx } from '../../utils/classNames';

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
  return (
    <footer className={styles.bar}>
      <div className={styles.group}>
        {/* Status is never signalled by colour alone. */}
        <span className={dotClassFor(status)} aria-hidden="true" />
        <span className={styles.item}>{statusText}</span>
      </div>
      <div className={styles.group}>
        <span className={styles.item}>{documentText}</span>
        <span className={styles.item}>{themeText}</span>
      </div>
    </footer>
  );
}
