import { useEffect, type ReactElement } from 'react';
import type { ResolvedTheme, ThemePreference } from '@shared/schemas/settings';
import { AppShell } from '../components/shell/AppShell';
import { FoundationView } from '../components/workspace/FoundationView';
import { useAppStore } from '../stores/appStore';
import { AppErrorBoundary } from './AppErrorBoundary';

const STATUS_TEXT = {
  idle: 'Starting…',
  loading: 'Loading settings…',
  ready: 'Ready',
  error: 'Startup problem',
} as const;

function describeTheme(preference: ThemePreference, resolved: ResolvedTheme | null): string {
  const resolvedLabel = resolved === null ? 'unknown' : resolved;
  return preference === 'system' ? `Theme: ${resolvedLabel} (system)` : `Theme: ${preference}`;
}

export function App(): ReactElement {
  const status = useAppStore((state) => state.status);
  const settings = useAppStore((state) => state.settings);
  const theme = useAppStore((state) => state.theme);
  const appInfo = useAppStore((state) => state.appInfo);
  const error = useAppStore((state) => state.error);
  const initialize = useAppStore((state) => state.initialize);
  const setThemePreference = useAppStore((state) => state.setThemePreference);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  const resolvedTheme = theme?.resolved ?? null;
  useEffect(() => {
    if (resolvedTheme === null) return;
    document.documentElement.dataset['theme'] = resolvedTheme;
  }, [resolvedTheme]);

  const preference = settings?.appearance.theme ?? 'system';

  return (
    <AppShell
      version={appInfo?.version ?? null}
      themePreference={preference}
      onThemePreferenceChange={(next) => {
        void setThemePreference(next);
      }}
      status={status}
      statusText={STATUS_TEXT[status]}
      themeText={describeTheme(preference, resolvedTheme)}
    >
      <AppErrorBoundary region="workspace">
        <FoundationView
          appInfo={appInfo}
          themePreference={preference}
          onThemePreferenceChange={(next) => {
            void setThemePreference(next);
          }}
          error={error}
          loading={status !== 'ready'}
        />
      </AppErrorBoundary>
    </AppShell>
  );
}
