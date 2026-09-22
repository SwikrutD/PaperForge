import { useState, type ReactElement } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Maximize,
  MoveHorizontal,
  RotateCcw,
  RotateCw,
  Scan,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useDocumentStore, type DocumentTab } from '../../stores/documentStore';
import { cx } from '../../utils/classNames';
import { IconButton } from '../controls/IconButton';
import { nextZoomStep, type ZoomMode } from './viewerLayout';
import styles from './ViewerToolbar.module.css';

interface ViewerToolbarProps {
  tab: DocumentTab;
  pageCount: number;
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
  scale,
  disabled,
  onGoToPage,
}: ViewerToolbarProps): ReactElement {
  const updateView = useDocumentStore((store) => store.updateView);
  const { view } = tab;
  // While the field is being edited it shows the draft; otherwise it follows
  // the scroll position.
  const [draft, setDraft] = useState<string | null>(null);
  const pageInput = draft ?? String(view.pageNumber);

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
    const parsed = Number.parseInt(pageInput, 10);
    setDraft(null);
    if (Number.isNaN(parsed)) return;
    onGoToPage(parsed);
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
            inputMode="numeric"
            aria-label="Page number"
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
          <span className={styles.pageCount}>{`of ${pageCount || 1}`}</span>
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
