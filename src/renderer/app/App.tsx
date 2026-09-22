import { useEffect, type ReactElement } from 'react';
import {
  DEFAULT_SETTINGS,
  type ResolvedTheme,
  type ThemePreference,
} from '@shared/schemas/settings';
import { CommandPalette } from '../components/overlays/CommandPalette';
import { AboutDialog } from '../components/overlays/AboutDialog';
import { SettingsDialog } from '../components/overlays/SettingsDialog';
import { ToastHost } from '../components/overlays/ToastHost';
import { ProgressCenter } from '../components/progress/ProgressCenter';
import { HomeScreen } from '../components/home/HomeScreen';
import { AppShell } from '../components/shell/AppShell';
import { ErrorMessageBar } from '../components/surfaces/MessageBar';
import { useAppStore } from '../stores/appStore';
import { useUiStore } from '../stores/uiStore';
import { AppErrorBoundary } from './AppErrorBoundary';
import styles from './App.module.css';

const STATUS_TEXT = {
  idle: 'Starting…',
  loading: 'Loading settings…',
  ready: 'Ready',
  error: 'Startup problem',
} as const;

function describeTheme(preference: ThemePreference, resolved: ResolvedTheme | null): string {
  const resolvedLabel = resolved ?? 'unknown';
  return preference === 'system' ? `Theme: ${resolvedLabel} (system)` : `Theme: ${preference}`;
}

export function App(): ReactElement {
  const status = useAppStore((state) => state.status);
  const settings = useAppStore((state) => state.settings);
  const theme = useAppStore((state) => state.theme);
  const appInfo = useAppStore((state) => state.appInfo);
  const recentFiles = useAppStore((state) => state.recentFiles);
  const error = useAppStore((state) => state.error);
  const initialize = useAppStore((state) => state.initialize);

  const dialog = useUiStore((state) => state.dialog);
  const paletteOpen = useUiStore((state) => state.commandPaletteOpen);
  const progressOpen = useUiStore((state) => state.progressCenterOpen);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  const resolvedTheme = theme?.resolved ?? null;
  useEffect(() => {
    if (resolvedTheme === null) return;
    document.documentElement.dataset['theme'] = resolvedTheme;
  }, [resolvedTheme]);

  // Before settings arrive the shell renders with defaults; every command stays
  // disabled until the real values are in, so nothing can be changed blindly.
  const effectiveSettings = settings ?? DEFAULT_SETTINGS;
  const preference = effectiveSettings.appearance.theme;

  return (
    <AppShell
      settings={effectiveSettings}
      version={appInfo?.version ?? null}
      status={status}
      statusText={STATUS_TEXT[status]}
      themeText={describeTheme(preference, resolvedTheme)}
      overlays={
        <>
          {progressOpen && <ProgressCenter />}
          {paletteOpen && <CommandPalette />}
          {dialog === 'settings' && <SettingsDialog settings={effectiveSettings} />}
          {dialog === 'about' && <AboutDialog appInfo={appInfo} />}
          <ToastHost />
        </>
      }
    >
      <AppErrorBoundary region="workspace">
        {error !== null && (
          <div className={styles.startupError}>
            <ErrorMessageBar error={error} />
          </div>
        )}
        <HomeScreen recentFiles={recentFiles} />
      </AppErrorBoundary>
    </AppShell>
  );
}
