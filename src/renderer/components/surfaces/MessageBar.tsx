import type { ReactElement } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { SerializedAppError } from '@shared/errors/appError';
import styles from './MessageBar.module.css';
import { cx } from '../../utils/classNames';

interface ErrorMessageBarProps {
  error: SerializedAppError;
}

/**
 * User-facing failure text with diagnostics behind a "Details" expander —
 * never a raw stack trace in the default view.
 */
export function ErrorMessageBar({ error }: ErrorMessageBarProps): ReactElement {
  return (
    <div className={cx(styles.bar, styles.error)} role="alert">
      <AlertTriangle className={styles.icon} aria-hidden="true" strokeWidth={1.75} />
      <div className={styles.body}>
        <span>{error.message}</span>
        {error.details !== undefined && (
          <details>
            <summary className={styles.summary}>Details</summary>
            <p className={styles.details}>{`${error.code} — ${error.details}`}</p>
          </details>
        )}
      </div>
    </div>
  );
}
