import type { ButtonHTMLAttributes, ReactElement } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cx } from '../../utils/classNames';
import styles from './IconButton.module.css';

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  icon: LucideIcon;
  /** Accessible name; also used as the tooltip unless `tooltip` overrides it. */
  label: string;
  tooltip?: string | undefined;
  /** Renders the pressed/active state for toggles. */
  pressed?: boolean | undefined;
  size?: 'small' | 'medium';
  /** Shown as the tooltip when the button is disabled. */
  disabledReason?: string | undefined;
}

/**
 * Toolbar-style button. Always carries an accessible name, a tooltip, and
 * distinct hover, pressed and disabled states.
 */
export function IconButton({
  icon: Icon,
  label,
  tooltip,
  pressed,
  size = 'medium',
  disabled = false,
  disabledReason,
  type = 'button',
  ...rest
}: IconButtonProps): ReactElement {
  const title = disabled && disabledReason !== undefined ? disabledReason : (tooltip ?? label);
  return (
    <button
      {...rest}
      type={type}
      className={cx(
        styles.button,
        size === 'small' && styles.small,
        pressed === true && styles.pressed,
      )}
      aria-label={label}
      title={title}
      disabled={disabled}
      {...(pressed === undefined ? {} : { 'aria-pressed': pressed })}
    >
      <Icon className={styles.icon} aria-hidden="true" strokeWidth={1.75} />
    </button>
  );
}
