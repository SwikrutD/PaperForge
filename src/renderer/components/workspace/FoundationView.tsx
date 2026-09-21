import type { ReactElement } from 'react';
import type { AppInfo } from '@shared/schemas/appInfo';
import type { SerializedAppError } from '@shared/errors/appError';
import type { ThemePreference } from '@shared/schemas/settings';
import { EnvironmentPanel } from '../diagnostics/EnvironmentPanel';
import { ErrorMessageBar } from '../surfaces/MessageBar';
import { Card } from '../surfaces/Card';
import { ThemeSwitcher } from '../controls/ThemeSwitcher';
import styles from './FoundationView.module.css';

interface FoundationViewProps {
  appInfo: AppInfo | null;
  themePreference: ThemePreference;
  onThemePreferenceChange: (preference: ThemePreference) => void;
  error: SerializedAppError | null;
  loading: boolean;
}

/**
 * Content shown while no document workspace exists yet. Segment 1 replaces this
 * with the Home screen (Open, Create, Recent, Tools).
 */
export function FoundationView({
  appInfo,
  themePreference,
  onThemePreferenceChange,
  error,
  loading,
}: FoundationViewProps): ReactElement {
  return (
    <div className={styles.view}>
      <div className={styles.intro}>
        <h1 className={styles.title}>PaperForge</h1>
        <p className={styles.lead}>
          An offline PDF workspace for Windows. Files stay on this computer: no account, no
          telemetry, no cloud services.
        </p>
        <p className={styles.lead}>
          This build contains the application foundation — the secure window shell, validated
          settings storage and the Fluent Workspace design tokens. Opening and viewing documents is
          not part of it yet.
        </p>
      </div>

      {error !== null && <ErrorMessageBar error={error} />}

      <div className={styles.cards}>
        <Card title="Appearance" description="Light, dark, or follow the Windows setting.">
          <ThemeSwitcher
            value={themePreference}
            onChange={onThemePreferenceChange}
            disabled={loading}
          />
        </Card>

        <Card title="Environment" description="What this installation is running on.">
          {appInfo === null ? (
            <p className={styles.loading}>Reading environment…</p>
          ) : (
            <EnvironmentPanel info={appInfo} />
          )}
        </Card>
      </div>
    </div>
  );
}
