import { useState, type ReactElement } from 'react';
import {
  BookImage,
  ChevronDown,
  ChevronUp,
  Columns2,
  Maximize,
  MoveHorizontal,
  RectangleVertical,
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
import { CommandIconButton } from '../controls/CommandIconButton';
import { IconButton } from '../controls/IconButton';
import { resolvePageEntry } from './pageEntry';
import { rowIndexOf, rowOptionsFor, stepPage } from './pageRows';
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
  // Previous and next move a row at a time: a pair of pages in a spread.
  const rowOptions = rowOptionsFor(view);
  const row = rowIndexOf(view.pageNumber, rowOptions);
  const previousPage = stepPage(view.pageNumber, -1, pageCount, rowOptions);
  const nextPage = stepPage(view.pageNumber, 1, pageCount, rowOptions);

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
          disabled={disabled || row === 0}
          onClick={() => onGoToPage(previousPage)}
        />
        <IconButton
          icon={ChevronDown}
          label="Next page"
          disabled={disabled || rowIndexOf(nextPage, rowOptions) === row}
          onClick={() => onGoToPage(nextPage)}
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
            // Leaving the field goes to what was typed, if anything was. After
            // Enter there is no draft, and the page shown may not have caught up
            // with the jump yet, so committing it would jump straight back.
            onBlur={() => {
              if (draft !== null) commitPage();
            }}
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
        <CommandIconButton id="edit.rotatePageLeft" icon={RotateCcwSquare} disabled={disabled} />
        <CommandIconButton id="edit.rotatePageRight" icon={RotateCwSquare} disabled={disabled} />
        <CommandIconButton id="edit.deletePage" icon={Trash} disabled={disabled} />
        <span className={styles.divider} aria-hidden="true" />
        <CommandIconButton id="edit.undo" icon={Undo2} disabled={disabled} />
        <CommandIconButton id="edit.redo" icon={Redo2} disabled={disabled} />
        <CommandIconButton id="file.save" icon={Save} disabled={disabled} />
      </div>

      <div className={cx(styles.group, styles.trailing)}>
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

        <span className={styles.divider} aria-hidden="true" />
        <CommandIconButton id="view.singlePage" icon={RectangleVertical} disabled={disabled} />
        <CommandIconButton id="view.twoPage" icon={Columns2} disabled={disabled} />
        <CommandIconButton id="view.coverPage" icon={BookImage} disabled={disabled} />

        <span className={styles.divider} aria-hidden="true" />
        {/*
          View rotation only turns the page on screen. The commands that turn
          the page in the document sit with the other document actions.
        */}
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
