import type { ReactElement, ReactNode } from 'react';
import type { ThemePreference } from '@shared/schemas/settings';
import type { AppStatus } from '../../stores/appStore';
import { AppHeader } from './AppHeader';
import { StatusBar } from './StatusBar';
import styles from './AppShell.module.css';

interface AppShellProps {
  children: ReactNode;
  version: string | null;
  themePreference: ThemePreference;
  onThemePreferenceChange: (preference: ThemePreference) => void;
  status: AppStatus;
  statusText: string;
  themeText: string;
}

/**
 * Vertical application frame: header, workspace region, status bar. Segment 1
 * adds the left rail, side panels and command bar inside `.body`.
 */
export function AppShell({
  children,
  version,
  themePreference,
  onThemePreferenceChange,
  status,
  statusText,
  themeText,
}: AppShellProps): ReactElement {
  return (
    <div className={styles.shell}>
      <AppHeader
        version={version}
        themePreference={themePreference}
        onThemePreferenceChange={onThemePreferenceChange}
        themeDisabled={status !== 'ready'}
      />
      <div className={styles.body}>
        <main className={styles.content}>{children}</main>
      </div>
      <StatusBar
        status={status}
        statusText={statusText}
        documentText="No document open"
        themeText={themeText}
      />
    </div>
  );
}
