import { useEffect, useState, type ReactElement } from 'react';
import styles from './ReadingModeNotice.module.css';

/** How long the notice stays up after reading mode starts. */
const NOTICE_MS = 4000;

/**
 * The notice, as reading mode starts, of how to leave it. Rendered only while
 * reading mode is on, so each start shows it again. It sits at the foot of
 * the window, clear of the document's own toolbar.
 */
export function ReadingModeNotice(): ReactElement {
  const [shown, setShown] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => setShown(false), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <p className={styles.notice} data-shown={shown} aria-live="polite">
      {shown ? 'Reading mode. Press Esc to exit.' : ''}
    </p>
  );
}
