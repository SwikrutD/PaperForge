import type { ReactElement, ReactNode } from 'react';
import styles from './Card.module.css';

interface CardProps {
  title: string;
  description?: string;
  children: ReactNode;
}

export function Card({ title, description, children }: CardProps): ReactElement {
  return (
    <section className={styles.card}>
      <div className={styles.header}>
        <h2 className={styles.title}>{title}</h2>
        {description !== undefined && <p className={styles.description}>{description}</p>}
      </div>
      {children}
    </section>
  );
}
