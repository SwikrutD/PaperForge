import { useId, type ReactElement } from 'react';
import styles from './Toggle.module.css';

interface ToggleProps {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

/**
 * A native checkbox styled as a Windows switch, so keyboard operation, the
 * focus ring and screen-reader semantics come for free.
 */
export function Toggle({ checked, label, onChange, disabled = false }: ToggleProps): ReactElement {
  const id = useId();

  return (
    <span className={styles.wrapper}>
      <input
        id={id}
        className={styles.input}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <label className={styles.track} htmlFor={id}>
        <span className={styles.thumb} aria-hidden="true" />
        <span className={styles.text}>{label}</span>
      </label>
    </span>
  );
}
