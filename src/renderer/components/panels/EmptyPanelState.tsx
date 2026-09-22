import type { ReactElement } from 'react';
import type { LucideIcon } from 'lucide-react';
import styles from './EmptyPanelState.module.css';

interface EmptyPanelStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
}

/** Honest empty state for a panel that has nothing to show yet. */
export function EmptyPanelState({
  icon: Icon,
  title,
  description,
}: EmptyPanelStateProps): ReactElement {
  return (
    <div className={styles.empty}>
      <Icon className={styles.icon} aria-hidden="true" strokeWidth={1.25} />
      <p className={styles.title}>{title}</p>
      <p className={styles.description}>{description}</p>
    </div>
  );
}
