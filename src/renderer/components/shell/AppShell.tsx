import { useState, type ReactElement, type ReactNode } from 'react';
import type { Settings } from '@shared/schemas/settings';
import type { AppStatus } from '../../stores/appStore';
import { useAppStore } from '../../stores/appStore';
import { LeftPanel } from '../panels/LeftPanel';
import { RightPanel } from '../panels/RightPanel';
import { CommandBar } from './CommandBar';
import { LeftRail } from './LeftRail';
import { PanelResizer } from './PanelResizer';
import { StatusBar } from './StatusBar';
import { TitleBar } from './TitleBar';
import styles from './AppShell.module.css';

interface AppShellProps {
  children: ReactNode;
  settings: Settings;
  version: string | null;
  status: AppStatus;
  statusText: string;
  themeText: string;
  /** Overlays (palette, dialogs, toasts) render above the whole frame. */
  overlays?: ReactNode;
}

/**
 * The window frame: title bar, command bar, rail, side panels, workspace and
 * status bar. Panel widths are dragged locally for smoothness and written to
 * settings once the gesture ends.
 */
export function AppShell({
  children,
  settings,
  version,
  status,
  statusText,
  themeText,
  overlays,
}: AppShellProps): ReactElement {
  const patchSettings = useAppStore((state) => state.patchSettings);
  const { layout } = settings;

  // While a divider is being dragged the width comes from the gesture; the rest
  // of the time settings are the single source of truth.
  const [drag, setDrag] = useState<{ side: 'left' | 'right'; width: number } | null>(null);
  const leftWidth = drag?.side === 'left' ? drag.width : layout.leftPanel.width;
  const rightWidth = drag?.side === 'right' ? drag.width : layout.rightPanel.width;

  const commitWidth = (side: 'left' | 'right', width: number): void => {
    setDrag(null);
    const patch =
      side === 'left'
        ? { layout: { leftPanel: { width } } }
        : { layout: { rightPanel: { width } } };
    void patchSettings(patch);
  };

  return (
    <div className={styles.shell}>
      <TitleBar version={version} />
      {layout.commandBarVisible && <CommandBar />}

      <div className={styles.body}>
        <LeftRail />

        {layout.leftPanel.visible && (
          <>
            <div className={styles.leftPanel} style={{ width: `${leftWidth}px` }}>
              <LeftPanel panel={layout.activeLeftPanel} />
            </div>
            <PanelResizer
              side="left"
              width={leftWidth}
              label="Resize the navigation panel"
              onResize={(width) => setDrag({ side: 'left', width })}
              onCommit={(width) => commitWidth('left', width)}
            />
          </>
        )}

        <main className={styles.workspace} data-focus-region="workspace" tabIndex={-1}>
          {children}
        </main>

        {layout.rightPanel.visible && (
          <>
            <PanelResizer
              side="right"
              width={rightWidth}
              label="Resize the tools panel"
              onResize={(width) => setDrag({ side: 'right', width })}
              onCommit={(width) => commitWidth('right', width)}
            />
            <div className={styles.rightPanel} style={{ width: `${rightWidth}px` }}>
              <RightPanel panel={layout.activeRightPanel} />
            </div>
          </>
        )}
      </div>

      <StatusBar
        status={status}
        statusText={statusText}
        documentText="No document open"
        themeText={themeText}
      />
      {overlays}
    </div>
  );
}
