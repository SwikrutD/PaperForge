import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import type { Settings } from '@shared/schemas/settings';
import type { AppStatus } from '../../stores/appStore';
import { useAppStore } from '../../stores/appStore';
import { useUiStore } from '../../stores/uiStore';
import { LeftPanel } from '../panels/LeftPanel';
import { RightPanel } from '../panels/RightPanel';
import { CommandBar } from './CommandBar';
import { FileDropZone } from './FileDropZone';
import { LeftRail } from './LeftRail';
import { PanelResizer } from './PanelResizer';
import { ReadingModeNotice } from './ReadingModeNotice';
import { usePointerAtTop } from './usePointerAtTop';
import { StatusBar } from './StatusBar';
import { TitleBar } from './TitleBar';
import styles from './AppShell.module.css';

interface AppShellProps {
  children: ReactNode;
  settings: Settings;
  version: string | null;
  status: AppStatus;
  /** Shown in the status bar only while PaperForge is not ready. */
  statusText: string;
  /** What the status bar says about the active document. */
  documentText: readonly string[];
  /** Page, zoom and rotation of the active document, when there is one. */
  viewText?: string | null;
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
  documentText,
  viewText = null,
  overlays,
}: AppShellProps): ReactElement {
  const patchSettings = useAppStore((state) => state.patchSettings);
  const readingMode = useUiStore((state) => state.readingMode);
  const setReadingMode = useUiStore((state) => state.setReadingMode);
  const { layout } = settings;
  const offerExit = usePointerAtTop(readingMode);

  // Escape is the way out of reading mode, since the bars that would offer one
  // are exactly what it hides.
  useEffect(() => {
    if (!readingMode) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      setReadingMode(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [readingMode, setReadingMode]);

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
    <FileDropZone>
      <TitleBar
        version={version}
        menuBarHidden={!layout.menuBarVisible && !readingMode}
        onShowMenuBar={() => void patchSettings({ layout: { menuBarVisible: true } })}
        onExitReadingMode={offerExit ? () => setReadingMode(false) : undefined}
      />
      {layout.menuBarVisible && !readingMode && <CommandBar />}
      {readingMode && <ReadingModeNotice />}

      <div className={styles.body}>
        {!readingMode && <LeftRail />}

        {layout.leftPanel.visible && !readingMode && (
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

        {layout.rightPanel.visible && !readingMode && (
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

      {!readingMode && (
        <StatusBar
          status={status}
          statusText={statusText}
          documentText={documentText}
          viewText={viewText}
        />
      )}
      {overlays}
    </FileDropZone>
  );
}
