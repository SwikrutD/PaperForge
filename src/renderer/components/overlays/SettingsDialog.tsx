import { useEffect, type ReactElement } from 'react';
import type { Settings } from '@shared/schemas/settings';
import { useCommands } from '../../commands/useCommands';
import { useAppStore } from '../../stores/appStore';
import { useUiStore } from '../../stores/uiStore';
import { useSignatureStore } from '../../stores/signatureStore';
import { Button } from '../controls/Button';
import { ThemeSwitcher } from '../controls/ThemeSwitcher';
import { Toggle } from '../controls/Toggle';
import { Dialog } from './Dialog';
import { QpdfSetting } from './QpdfSetting';
import { OfficeSetting } from './OfficeSetting';
import { OcrSetting } from './OcrSetting';
import { WindowsSetting } from './WindowsSetting';
import styles from './SettingsDialog.module.css';

interface SettingRowProps {
  label: string;
  description: string;
  children: ReactElement;
}

function SettingRow({ label, description, children }: SettingRowProps): ReactElement {
  return (
    <div className={styles.row}>
      <div className={styles.rowText}>
        <p className={styles.rowLabel}>{label}</p>
        <p className={styles.rowDescription}>{description}</p>
      </div>
      <div className={styles.rowControl}>{children}</div>
    </div>
  );
}

/**
 * Settings that exist today: appearance, the privacy controls for local
 * history, and the local tools PaperForge can make use of. Further sections
 * (viewing, editing, OCR, conversions) appear as those features are built.
 */
export function SettingsDialog({ settings }: { settings: Settings }): ReactElement {
  const closeDialog = useUiStore((state) => state.closeDialog);
  const setThemePreference = useAppStore((state) => state.setThemePreference);
  const patchSettings = useAppStore((state) => state.patchSettings);
  const recentFiles = useAppStore((state) => state.recentFiles);
  const { execute, resolve } = useCommands();

  const clearCommand = resolve('privacy.clearRecentFiles');
  const signatures = useSignatureStore((store) => store.saved);
  const loadSignatures = useSignatureStore((store) => store.loadSaved);

  // The list is read when the dialog opens, so the count is what is there.
  useEffect(() => {
    void loadSignatures();
  }, [loadSignatures]);

  return (
    <Dialog
      title="Settings"
      description="Stored on this computer only."
      onClose={closeDialog}
      footer={
        <Button appearance="primary" onClick={closeDialog}>
          Close
        </Button>
      }
    >
      <section className={styles.section} aria-label="General">
        <h3 className={styles.sectionTitle}>General</h3>
        <SettingRow
          label="Reopen documents"
          description="Open the documents from your last session when PaperForge starts."
        >
          <Toggle
            checked={settings.session.restoreOnStartup}
            label={settings.session.restoreOnStartup ? 'On' : 'Off'}
            onChange={(checked) => void patchSettings({ session: { restoreOnStartup: checked } })}
          />
        </SettingRow>
      </section>

      <section className={styles.section} aria-label="Windows">
        <h3 className={styles.sectionTitle}>Windows</h3>
        <WindowsSetting />
        <SettingRow
          label="Notify when work finishes"
          description="A Windows notification when long work, such as recognising text or printing, finishes while PaperForge is in the background."
        >
          <Toggle
            checked={settings.notifications.whenDone}
            label={settings.notifications.whenDone ? 'On' : 'Off'}
            onChange={(checked) => void patchSettings({ notifications: { whenDone: checked } })}
          />
        </SettingRow>
      </section>

      <section className={styles.section} aria-label="Appearance">
        <h3 className={styles.sectionTitle}>Appearance</h3>
        <SettingRow label="Theme" description="Follow the Windows setting, or pick light or dark.">
          <ThemeSwitcher
            value={settings.appearance.theme}
            onChange={(preference) => void setThemePreference(preference)}
          />
        </SettingRow>
      </section>

      <section className={styles.section} aria-label="Privacy">
        <h3 className={styles.sectionTitle}>Privacy</h3>
        <SettingRow
          label="Recent files"
          description={
            recentFiles.length === 0
              ? 'No files have been opened yet.'
              : `${recentFiles.length} file${recentFiles.length === 1 ? '' : 's'} remembered on this computer.`
          }
        >
          <Button
            disabled={clearCommand?.enabled === false}
            title={clearCommand?.enabled === false ? clearCommand.reason : undefined}
            onClick={() => execute('privacy.clearRecentFiles')}
          >
            Clear
          </Button>
        </SettingRow>
        <SettingRow
          label="Saved signatures"
          description={
            signatures.length === 0
              ? 'None are kept on this computer.'
              : `${String(signatures.length)} kept on this computer, and never sent anywhere.`
          }
        >
          <Button
            disabled={signatures.length === 0}
            onClick={() => {
              void useSignatureStore.getState().clearSaved();
            }}
          >
            Clear
          </Button>
        </SettingRow>
        <p className={styles.note}>
          PaperForge collects no telemetry and sends nothing anywhere. Logs stay in the local log
          folder and passwords are never written to them.
        </p>
      </section>

      <section className={styles.section} aria-label="Text recognition">
        <h3 className={styles.sectionTitle}>Text recognition</h3>
        <OcrSetting />
      </section>

      <section className={styles.section} aria-label="Local tools">
        <h3 className={styles.sectionTitle}>Local tools</h3>
        <QpdfSetting />
        <OfficeSetting />
        <p className={styles.note}>
          Optional. PaperForge reopens everything it saves to check it; with qpdf installed it is
          inspected a second time before it replaces your file. Nothing is ever downloaded.
        </p>
      </section>
    </Dialog>
  );
}
