import { useState, type ReactElement } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Maximize,
  MoveHorizontal,
  Redo2,
  RotateCcw,
  RotateCcwSquare,
  RotateCw,
  RotateCwSquare,
  Save,
  Scan,
  Trash,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useDocumentStore, type DocumentTab } from '../../stores/documentStore';
import { cx } from '../../utils/classNames';
import { useCommands } from '../../commands/useCommands';
import { IconButton } from '../controls/IconButton';
import { resolvePageEntry } from './pageEntry';
import { nextZoomStep, type ZoomMode } from './viewerLayout';
import styles from './ViewerToolbar.module.css';

interface ViewerToolbarProps {
  tab: DocumentTab;
  pageCount: number;
  /**
   * The label each page carries, when the document numbers its pages its own
   * way — roman numerals for a preface, say. Null where a page has none.
   */
  pageLabels: readonly (string | null)[];
  /** The scale actually in use, which a fit mode computes. */
  scale: number;
  disabled: boolean;
  onGoToPage: (pageNumber: number) => void;
}

const ZOOM_MODES: Array<{ mode: ZoomMode; label: string; icon: typeof Scan }> = [
  { mode: 'fitPage', label: 'Fit page', icon: Scan },
  { mode: 'fitWidth', label: 'Fit width', icon: MoveHorizontal },
  { mode: 'actual', label: 'Actual size', icon: Maximize },
];

export function ViewerToolbar({
  tab,
  pageCount,
  pageLabels,
  scale,
  disabled,
  onGoToPage,
}: ViewerToolbarProps): ReactElement {
  const updateView = useDocumentStore((store) => store.updateView);
  const { view } = tab;
  // While the field is being edited it shows the draft; otherwise it follows
  // the scroll position.
  const [draft, setDraft] = useState<string | null>(null);
  const currentLabel = pageLabels[view.pageNumber - 1] ?? null;
  const pageInput = draft ?? currentLabel ?? String(view.pageNumber);

  const setZoom = (mode: ZoomMode, nextScale?: number): void => {
    updateView(tab.session.id, {
      zoomMode: mode,
      ...(nextScale === undefined ? {} : { scale: nextScale }),
    });
  };

  const rotate = (direction: 1 | -1): void => {
    const next = (((view.rotation + direction * 90) % 360) + 360) % 360;
    updateView(tab.session.id, { rotation: next as 0 | 90 | 180 | 270 });
  };

  const commitPage = (): void => {
    const pageNumber = resolvePageEntry(pageInput, pageLabels, pageCount);
    setDraft(null);
    if (pageNumber !== null) onGoToPage(pageNumber);
  };

  return (
    <div className={styles.toolbar} role="toolbar" aria-label="Document view">
      <div className={styles.group}>
        <IconButton
          icon={ChevronUp}
          label="Previous page"
          disabled={disabled || view.pageNumber <= 1}
          onClick={() => onGoToPage(view.pageNumber - 1)}
        />
        <IconButton
          icon={ChevronDown}
          label="Next page"
          disabled={disabled || view.pageNumber >= pageCount}
          onClick={() => onGoToPage(view.pageNumber + 1)}
        />
        <span className={styles.pageBox}>
          <input
            className={styles.pageInput}
            type="text"
            inputMode={currentLabel === null ? 'numeric' : 'text'}
            aria-label={currentLabel === null ? 'Page number' : 'Page number or label'}
            title={currentLabel === null ? undefined : `Page ${view.pageNumber} of ${pageCount}`}
            value={pageInput}
            disabled={disabled}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitPage}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commitPage();
              }
            }}
          />
          <span className={styles.pageCount}>
            {currentLabel === null
              ? `of ${pageCount || 1}`
              : `(${view.pageNumber} of ${pageCount || 1})`}
          </span>
        </span>
      </div>

      <div className={styles.group}>
        <IconButton
          icon={ZoomOut}
          label="Zoom out"
          disabled={disabled}
          onClick={() => setZoom('custom', nextZoomStep(scale, -1))}
        />
        <span className={styles.zoomValue} aria-live="polite">{`${Math.round(scale * 100)}%`}</span>
        <IconButton
          icon={ZoomIn}
          label="Zoom in"
          disabled={disabled}
          onClick={() => setZoom('custom', nextZoomStep(scale, 1))}
        />

        {ZOOM_MODES.map(({ mode, label, icon }) => (
          <IconButton
            key={mode}
            icon={icon}
            label={label}
            pressed={view.zoomMode === mode}
            disabled={disabled}
            onClick={() => setZoom(mode)}
          />
        ))}
      </div>

      <div className={cx(styles.group, styles.trailing)}>
        {/*
          These change the document itself, so they sit apart from the view
          rotation beside them, which only turns the page on screen.
        */}
        <CommandButton id="edit.rotatePageLeft" icon={RotateCcwSquare} disabled={disabled} />
        <CommandButton id="edit.rotatePageRight" icon={RotateCwSquare} disabled={disabled} />
        <CommandButton id="edit.deletePage" icon={Trash} disabled={disabled} />
        <span className={styles.divider} aria-hidden="true" />
        <CommandButton id="edit.undo" icon={Undo2} disabled={disabled} />
        <CommandButton id="edit.redo" icon={Redo2} disabled={disabled} />
        <CommandButton id="file.save" icon={Save} disabled={disabled} />
        <span className={styles.divider} aria-hidden="true" />
        <IconButton
          icon={RotateCcw}
          label="Rotate view left"
          disabled={disabled}
          onClick={() => rotate(-1)}
        />
        <IconButton
          icon={RotateCw}
          label="Rotate view right"
          disabled={disabled}
          onClick={() => rotate(1)}
        />
      </div>
    </div>
  );
}

/**
 * A toolbar button backed by a command, so the toolbar, the menus and the
 * keyboard cannot disagree about whether something is possible or why not.
 */
function CommandButton({
  id,
  icon,
  disabled,
}: {
  id: string;
  icon: typeof Scan;
  disabled: boolean;
}): ReactElement | null {
  const { execute, resolve } = useCommands();
  const command = resolve(id);
  if (command === undefined) return null;

  const label = command.definition.shortcut
    ? `${command.definition.title} (${command.definition.shortcut})`
    : command.definition.title;

  return (
    <IconButton
      icon={icon}
      label={command.definition.title}
      tooltip={label}
      disabled={disabled || !command.enabled}
      disabledReason={command.reason}
      onClick={() => execute(id)}
    />
  );
}
