import type { ReactElement } from 'react';
import { Activity, Settings as SettingsIcon } from 'lucide-react';
import { APP_NAME } from '@shared/constants/app';
import { useCommands } from '../../commands/useCommands';
import { useUiStore } from '../../stores/uiStore';
import { useJobStore } from '../../stores/jobStore';
import { isJobActive } from '../../types/jobs';
import { LogoMark } from '../brand/LogoMark';
import { IconButton } from '../controls/IconButton';
import styles from './TitleBar.module.css';

/**
 * Top strip of the window: product identity, the document context area, and
 * window-level actions. Document tabs move into the centre region in Segment 2.
 */
export function TitleBar({ version }: { version: string | null }): ReactElement {
  const { execute, resolve } = useCommands();
  const progressOpen = useUiStore((state) => state.progressCenterOpen);
  const activeJobs = useJobStore((state) => state.jobs.filter(isJobActive).length);

  const settingsCommand = resolve('app.openSettings');
  const tasksCommand = resolve('app.toggleProgressCenter');

  return (
    <header className={styles.bar}>
      <div className={styles.brand}>
        <LogoMark size={20} />
        <span className={styles.name}>{APP_NAME}</span>
        {version !== null && <span className={styles.version}>{`v${version}`}</span>}
      </div>

      <div className={styles.documents} aria-label="Open documents">
        <span className={styles.noDocument}>No document open</span>
      </div>

      <div className={styles.actions}>
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
