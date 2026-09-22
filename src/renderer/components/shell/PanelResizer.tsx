import { useCallback, useRef, type ReactElement } from 'react';
import { PANEL_MAX_WIDTH, PANEL_MIN_WIDTH } from '@shared/schemas/settings';
import styles from './PanelResizer.module.css';

const KEYBOARD_STEP = 16;

interface PanelResizerProps {
  /** Which side the panel is on; decides which way dragging grows it. */
  side: 'left' | 'right';
  width: number;
  label: string;
  onResize: (width: number) => void;
  /** Called once when the gesture ends, so settings are written once. */
  onCommit: (width: number) => void;
}

function clampWidth(width: number): number {
  return Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, Math.round(width)));
}

/**
 * Draggable divider between a side panel and the workspace. It is a real
 * separator for assistive technology and can be resized with the keyboard.
 */
export function PanelResizer({
  side,
  width,
  label,
  onResize,
  onCommit,
}: PanelResizerProps): ReactElement {
  const latestWidth = useRef(width);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = width;
      const element = event.currentTarget;
      element.setPointerCapture(event.pointerId);

      const move = (moveEvent: PointerEvent): void => {
        const delta = moveEvent.clientX - startX;
        const next = clampWidth(side === 'left' ? startWidth + delta : startWidth - delta);
        latestWidth.current = next;
        onResize(next);
      };

      const finish = (): void => {
        element.releasePointerCapture(event.pointerId);
        element.removeEventListener('pointermove', move);
        element.removeEventListener('pointerup', finish);
        element.removeEventListener('pointercancel', finish);
        onCommit(latestWidth.current);
      };

      element.addEventListener('pointermove', move);
      element.addEventListener('pointerup', finish);
      element.addEventListener('pointercancel', finish);
    },
    [side, width, onResize, onCommit],
  );

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const grow = side === 'left' ? 'ArrowRight' : 'ArrowLeft';
    const shrink = side === 'left' ? 'ArrowLeft' : 'ArrowRight';
    let next: number | undefined;

    if (event.key === grow) next = clampWidth(width + KEYBOARD_STEP);
    else if (event.key === shrink) next = clampWidth(width - KEYBOARD_STEP);
    else if (event.key === 'Home') next = PANEL_MIN_WIDTH;
    else if (event.key === 'End') next = PANEL_MAX_WIDTH;

    if (next === undefined) return;
    event.preventDefault();
    latestWidth.current = next;
    onResize(next);
    onCommit(next);
  };

  return (
    <div
      className={styles.resizer}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={PANEL_MIN_WIDTH}
      aria-valuemax={PANEL_MAX_WIDTH}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    />
  );
}
