import type { ReactElement } from 'react';
import { Activity, FolderOpen, PanelTop, Search, Settings as SettingsIcon, X } from 'lucide-react';
import { APP_NAME } from '@shared/constants/app';
import { useCommands } from '../../commands/useCommands';
import { useUiStore } from '../../stores/uiStore';
import { useJobStore } from '../../stores/jobStore';
import { isJobActive } from '../../types/jobs';
import { useDocumentStore } from '../../stores/documentStore';
import { LogoMark } from '../brand/LogoMark';
import { IconButton } from '../controls/IconButton';
import { TabStrip } from './TabStrip';
import styles from './TitleBar.module.css';

interface TitleBarProps {
  version: string | null;
  /** True while Settings has the menu bar hidden (reading mode aside). */
  menuBarHidden?: boolean;
  onShowMenuBar?: () => void;
  /** Offered in reading mode while the pointer is at the top of the window. */
  onExitReadingMode?: (() => void) | undefined;
}

/**
 * Top strip of the window: product identity, the document tabs, and
 * window-level actions. It is always there, reading mode included, so
 * Settings is always a click away. While the menu bar is hidden it also
 * carries the menu bar's search and a button that brings the menu bar back;
 * in reading mode, a way out when the pointer comes up to it.
 */
export function TitleBar({
  version,
  menuBarHidden = false,
  onShowMenuBar,
  onExitReadingMode,
}: TitleBarProps): ReactElement {
  const { execute, resolve } = useCommands();
  const progressOpen = useUiStore((state) => state.progressCenterOpen);
  const activeJobs = useJobStore((state) => state.jobs.filter(isJobActive).length);

  const settingsCommand = resolve('app.openSettings');
  const tasksCommand = resolve('app.toggleProgressCenter');
  const openCommand = resolve('file.open');
  const hasDocuments = useDocumentStore((state) => state.tabs.length > 0);

  return (
    <header className={styles.bar}>
      <div className={styles.brand}>
        <LogoMark size={20} />
        <span className={styles.name}>{APP_NAME}</span>
        {version !== null && <span className={styles.version}>{`v${version}`}</span>}
      </div>

      <div className={styles.documents}>
        {hasDocuments ? <TabStrip /> : <span className={styles.noDocument}>No document open</span>}
      </div>

      <div className={styles.actions}>
        {onExitReadingMode !== undefined && (
          <button type="button" className={styles.exitReading} onClick={onExitReadingMode}>
            <X className={styles.exitIcon} aria-hidden="true" strokeWidth={1.75} />
            Exit reading mode
          </button>
        )}
        {menuBarHidden && (
          <>
            <IconButton
              icon={Search}
              label="Search commands"
              tooltip="Search commands (Ctrl+K)"
              onClick={() => execute('app.commandPalette')}
            />
            <IconButton
              icon={PanelTop}
              label="Show menu bar"
              tooltip="Show the menu bar again. Settings can hide it."
              onClick={onShowMenuBar}
            />
          </>
        )}
        <IconButton
          icon={FolderOpen}
          label="Open"
          tooltip="Open a PDF (Ctrl+O)"
          disabled={openCommand?.enabled === false}
          onClick={() => execute('file.open')}
        />
        <span className={styles.taskCount} aria-live="polite">
          {activeJobs > 0 ? `${activeJobs} running` : ''}
        </span>
        <IconButton
          icon={Activity}
          label="Background tasks"
          pressed={progressOpen}
          disabled={tasksCommand?.enabled === false}
          onClick={() => execute('app.toggleProgressCenter')}
        />
        <IconButton
          icon={SettingsIcon}
          label="Settings"
          tooltip="Settings (Ctrl+,)"
          disabled={settingsCommand?.enabled === false}
          onClick={() => execute('app.openSettings')}
        />
      </div>
    </header>
  );
}
