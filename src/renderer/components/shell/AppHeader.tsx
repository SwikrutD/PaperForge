import type { ReactElement } from 'react';
import { APP_NAME } from '@shared/constants/app';
import type { ThemePreference } from '@shared/schemas/settings';
import { LogoMark } from '../brand/LogoMark';
import { ThemeSwitcher } from '../controls/ThemeSwitcher';
import styles from './AppHeader.module.css';

interface AppHeaderProps {
  version: string | null;
  themePreference: ThemePreference;
  onThemePreferenceChange: (preference: ThemePreference) => void;
  themeDisabled: boolean;
}

/**
 * Application header. Segment 1 replaces this with the full title/tab bar and
 * command bar; the structure and tokens it uses stay the same.
 */
export function AppHeader({
  version,
  themePreference,
  onThemePreferenceChange,
  themeDisabled,
}: AppHeaderProps): ReactElement {
  return (
    <header className={styles.header}>
      <div className={styles.brand}>
        <LogoMark size={22} />
        <span className={styles.name}>{APP_NAME}</span>
        {version !== null && <span className={styles.tag}>{`v${version}`}</span>}
      </div>
      <div className={styles.actions}>
        <ThemeSwitcher
          value={themePreference}
          onChange={onThemePreferenceChange}
          disabled={themeDisabled}
        />
      </div>
    </header>
  );
}
