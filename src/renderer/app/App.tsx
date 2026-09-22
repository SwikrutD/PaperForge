import { useEffect, useState, type ReactElement } from 'react';
import {
  DEFAULT_SETTINGS,
  type ResolvedTheme,
  type ThemePreference,
} from '@shared/schemas/settings';
import type { RecoveryEntry } from '@shared/schemas/document';
import { CommandPalette } from '../components/overlays/CommandPalette';
import { AboutDialog } from '../components/overlays/AboutDialog';
import { ConfirmationDialog } from '../components/overlays/ConfirmationDialog';
import { RecoveryDialog } from '../components/overlays/RecoveryDialog';
import { SettingsDialog } from '../components/overlays/SettingsDialog';
import { ToastHost } from '../components/overlays/ToastHost';
import { ProgressCenter } from '../components/progress/ProgressCenter';
import { HomeScreen } from '../components/home/HomeScreen';
import { AppShell } from '../components/shell/AppShell';
import { DocumentView } from '../components/workspace/DocumentView';
import { ErrorMessageBar } from '../components/surfaces/MessageBar';
import { invoke } from '../services/ipcClient';
import { useAppStore } from '../stores/appStore';
import { useDocumentStore } from '../stores/documentStore';
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

  const tabs = useDocumentStore((state) => state.tabs);
  const activeId = useDocumentStore((state) => state.activeId);
  const initializeDocuments = useDocumentStore((state) => state.initialize);
  const restoreSession = useDocumentStore((state) => state.restoreSession);

  const dialog = useUiStore((state) => state.dialog);
  const paletteOpen = useUiStore((state) => state.commandPaletteOpen);
  const progressOpen = useUiStore((state) => state.progressCenterOpen);
  const confirmation = useUiStore((state) => state.confirmation);

  const [recovery, setRecovery] = useState<RecoveryEntry[] | null>(null);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  // Documents come up after the shell: recover what a crash left behind first,
  // and only restore the previous session when there is nothing to recover.
  useEffect(() => {
    let cancelled = false;
    const start = async (): Promise<void> => {
      await initializeDocuments();
      const entries = await invoke('recovery:list');
      if (cancelled) return;
      if (entries.length > 0) setRecovery(entries);
      else await restoreSession();
    };
    void start();
    return () => {
      cancelled = true;
    };
  }, [initializeDocuments, restoreSession]);

  const resolvedTheme = theme?.resolved ?? null;
  useEffect(() => {
    if (resolvedTheme === null) return;
    document.documentElement.dataset['theme'] = resolvedTheme;
  }, [resolvedTheme]);

  // Before settings arrive the shell renders with defaults; every command stays
  // disabled until the real values are in, so nothing can be changed blindly.
  const effectiveSettings = settings ?? DEFAULT_SETTINGS;
  const preference = effectiveSettings.appearance.theme;
  const activeTab = tabs.find((tab) => tab.session.id === activeId) ?? null;

  return (
    <AppShell
      settings={effectiveSettings}
      version={appInfo?.version ?? null}
      status={status}
      statusText={STATUS_TEXT[status]}
      themeText={describeTheme(preference, resolvedTheme)}
      documentText={
        activeTab === null
          ? 'No document open'
          : `${activeTab.session.file.displayName}${tabs.length > 1 ? ` · ${tabs.length} open` : ''}`
      }
      overlays={
        <>
          {progressOpen && <ProgressCenter />}
          {paletteOpen && <CommandPalette />}
          {dialog === 'settings' && <SettingsDialog settings={effectiveSettings} />}
          {dialog === 'about' && <AboutDialog appInfo={appInfo} />}
          {recovery !== null && (
            <RecoveryDialog
              entries={recovery}
              onDone={() => {
                setRecovery(null);
              }}
            />
          )}
          {confirmation !== null && <ConfirmationDialog request={confirmation} />}
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
        {activeTab === null ? (
          <HomeScreen recentFiles={recentFiles} />
        ) : (
          <DocumentView key={activeTab.session.id} tab={activeTab} />
        )}
      </AppErrorBoundary>
    </AppShell>
  );
}
