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
import { SearchRunner } from '../components/search/SearchRunner';
import { PdfDocumentProvider } from '../components/viewer/PdfDocumentContext';
import { PdfViewer } from '../components/viewer/PdfViewer';
import { OrganizeWorkspace } from '../components/organize/OrganizeWorkspace';
import { CreateWorkspace } from '../components/create/CreateWorkspace';
import { ErrorMessageBar } from '../components/surfaces/MessageBar';
import { invoke } from '../services/ipcClient';
import { useAppStore } from '../stores/appStore';
import { useDocumentStore, type DocumentViewState } from '../stores/documentStore';
import { useCreateStore } from '../stores/createStore';
import { useOrganizeStore } from '../stores/organizeStore';
import { useTextEditStore } from '../stores/textEditStore';
import { useCropStore } from '../stores/cropStore';
import { SignatureDialog } from '../components/forms/SignatureDialog';
import { FlattenDialog } from '../components/forms/FlattenDialog';
import { OcrDialog } from '../components/ocr/OcrDialog';
import { ExportDialog } from '../components/convert/ExportDialog';
import { DocumentPropertiesDialog } from '../components/admin/DocumentPropertiesDialog';
import { ProtectDialog } from '../components/admin/ProtectDialog';
import { SanitizeDialog } from '../components/admin/SanitizeDialog';
import { ApplyRedactionsDialog } from '../components/redact/ApplyRedactionsDialog';
import { RepairDialog } from '../components/repair/RepairDialog';
import { OptimizeDialog } from '../components/optimize/OptimizeDialog';
import { useSignatureStore } from '../stores/signatureStore';
import { useFormStore } from '../stores/formStore';
import { WatermarkDialog } from '../components/edit/furniture/WatermarkDialog';
import { BackgroundDialog } from '../components/edit/furniture/BackgroundDialog';
import { HeaderFooterDialog } from '../components/edit/furniture/HeaderFooterDialog';
import { useUiStore } from '../stores/uiStore';
import { AppErrorBoundary } from './AppErrorBoundary';
import styles from './App.module.css';

const STATUS_TEXT = {
  idle: 'Starting…',
  loading: 'Loading settings…',
  ready: 'Ready',
  error: 'Startup problem',
} as const;

const ZOOM_LABEL = {
  fitPage: 'Fit page',
  fitWidth: 'Fit width',
  actual: 'Actual size',
  custom: 'Custom zoom',
} as const;

/** "Page 2 of 3 · Fit width · 90°" for the status bar. */
function describeView(view: DocumentViewState): string {
  const parts = [`Page ${view.pageNumber}`, ZOOM_LABEL[view.zoomMode]];
  if (view.rotation !== 0) parts.push(`${view.rotation}°`);
  return parts.join(' · ');
}

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
  const closeDialog = useUiStore((state) => state.closeDialog);
  const signatureDialog = useSignatureStore((state) => state.open);
  const paletteOpen = useUiStore((state) => state.commandPaletteOpen);
  const progressOpen = useUiStore((state) => state.progressCenterOpen);
  const confirmation = useUiStore((state) => state.confirmation);

  const organizing = useOrganizeStore((state) => state.active);
  const creating = useCreateStore((state) => state.open);
  const editingText = useTextEditStore((state) => state.active);
  const setEditingText = useTextEditStore((state) => state.setActive);
  const setOrganizing = useOrganizeStore((state) => state.setActive);
  const filling = useFormStore((state) => state.active);
  const setFilling = useFormStore((state) => state.setActive);

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

  // Organizing pages, editing text and filling a form in are ways of working
  // on a document; with none open there is nothing to work on, so they close
  // rather than waiting behind the home screen for the next document.
  useEffect(() => {
    if (activeId !== null) return;
    if (organizing) setOrganizing(false);
    if (editingText) setEditingText(false);
    if (filling) setFilling(false);
    useCropStore.getState().setActive(false);
  }, [activeId, organizing, setOrganizing, editingText, setEditingText, filling, setFilling]);

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
  const viewText = activeTab === null ? null : describeView(activeTab.view);

  return (
    <PdfDocumentProvider tab={activeTab}>
      <SearchRunner />
      <AppShell
        settings={effectiveSettings}
        version={appInfo?.version ?? null}
        status={status}
        statusText={STATUS_TEXT[status]}
        themeText={describeTheme(preference, resolvedTheme)}
        viewText={viewText}
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
            {signatureDialog !== null && <SignatureDialog kind={signatureDialog} />}
            {dialog === 'flatten' && <FlattenDialog onClose={closeDialog} />}
            {dialog === 'ocr' && <OcrDialog onClose={closeDialog} />}
            {dialog === 'export' && <ExportDialog onClose={closeDialog} />}
            {dialog === 'properties' && <DocumentPropertiesDialog onClose={closeDialog} />}
            {dialog === 'protect' && <ProtectDialog onClose={closeDialog} />}
            {dialog === 'sanitize' && <SanitizeDialog onClose={closeDialog} />}
            {dialog === 'applyRedactions' && <ApplyRedactionsDialog onClose={closeDialog} />}
            {dialog === 'repair' && <RepairDialog onClose={closeDialog} />}
            {dialog === 'optimize' && <OptimizeDialog onClose={closeDialog} />}
            {dialog === 'watermark' && <WatermarkDialog onClose={closeDialog} />}
            {dialog === 'background' && <BackgroundDialog onClose={closeDialog} />}
            {dialog === 'headerFooter' && <HeaderFooterDialog onClose={closeDialog} />}
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
          {creating ? (
            // Making a document does not need one open, so it comes first.
            <CreateWorkspace />
          ) : activeTab === null ? (
            <HomeScreen recentFiles={recentFiles} />
          ) : organizing ? (
            <OrganizeWorkspace key={activeTab.session.id} tab={activeTab} />
          ) : (
            <PdfViewer key={activeTab.session.id} tab={activeTab} />
          )}
        </AppErrorBoundary>
      </AppShell>
    </PdfDocumentProvider>
  );
}
