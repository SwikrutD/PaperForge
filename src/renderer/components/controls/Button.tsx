import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import styles from './Button.module.css';
import { cx } from '../../utils/classNames';

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  children: ReactNode;
  icon?: LucideIcon;
  appearance?: 'default' | 'primary';
}

/** Baseline button: hover, pressed, disabled and focus states from the tokens. */
export function Button({
  children,
  icon: Icon,
  appearance = 'default',
  type = 'button',
  ...rest
}: ButtonProps): ReactElement {
  const className = cx(styles.button, appearance === 'primary' && styles.primary);
  return (
    <button className={className} type={type} {...rest}>
      {Icon !== undefined && <Icon className={styles.icon} aria-hidden="true" strokeWidth={1.75} />}
      {children}
    </button>
  );
}
