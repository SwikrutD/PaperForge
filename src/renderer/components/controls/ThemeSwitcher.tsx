import { useId, type ReactElement } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { themePreferenceSchema, type ThemePreference } from '@shared/schemas/settings';
import styles from './ThemeSwitcher.module.css';
import { cx } from '../../utils/classNames';

const OPTIONS: Array<{ value: ThemePreference; label: string; Icon: typeof Sun }> = [
  { value: 'system', label: 'System', Icon: Monitor },
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
];

interface ThemeSwitcherProps {
  value: ThemePreference;
  onChange: (value: ThemePreference) => void;
  disabled?: boolean;
}

/**
 * Native radio group so Windows keyboard conventions (arrow keys, focus ring,
 * screen-reader grouping) work without re-implementing them.
 */
export function ThemeSwitcher({
  value,
  onChange,
  disabled = false,
}: ThemeSwitcherProps): ReactElement {
  // Unique per instance: the control appears in more than one place, and radio
  // groups that share a name or an id would collide.
  const groupId = useId();

  return (
    <fieldset className={styles.group} disabled={disabled}>
      <legend className={cx(styles.legend, 'pf-visually-hidden')}>Appearance</legend>
      <div className={styles.segments}>
        {OPTIONS.map(({ value: option, label, Icon }) => (
          <span key={option} className={styles.segment}>
            <input
              className={styles.input}
              type="radio"
              id={`${groupId}-${option}`}
              name={groupId}
              value={option}
              checked={value === option}
              onChange={(event) => {
                onChange(themePreferenceSchema.parse(event.currentTarget.value));
              }}
            />
            <label className={styles.label} htmlFor={`${groupId}-${option}`}>
              <Icon className={styles.icon} aria-hidden="true" strokeWidth={1.75} />
              {label}
            </label>
          </span>
        ))}
      </div>
    </fieldset>
  );
}
