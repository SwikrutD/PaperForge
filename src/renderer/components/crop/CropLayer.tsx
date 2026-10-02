import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactElement } from 'react';
import type { PdfPageGeometry } from '@pdf/render/types';
import type { PageBoxRect } from '@shared/schemas/pages';
import { adjustFrame, type FrameHandle, type ScreenBox } from '@shared/utils/cropBoxes';
import { cssBoxStyle, cssRectToPdf, pdfRectToCss } from '../viewer/pageGeometry';
import styles from './CropLayer.module.css';

interface CropLayerProps {
  geometry: PdfPageGeometry;
  scale: number;
  rotation: number;
  /** The frame on this page, in PDF user space, or null when it is elsewhere. */
  frame: PageBoxRect | null;
  onChange: (rect: PageBoxRect) => void;
}

const HANDLES: readonly Exclude<FrameHandle, 'move'>[] = [
  'nw',
  'n',
  'ne',
  'e',
  'se',
  's',
  'sw',
  'w',
];

const HANDLE_NAMES: Record<Exclude<FrameHandle, 'move'>, string> = {
  n: 'top edge',
  s: 'bottom edge',
  e: 'right edge',
  w: 'left edge',
  ne: 'top-right corner',
  nw: 'top-left corner',
  se: 'bottom-right corner',
  sw: 'bottom-left corner',
};

/** A drag shorter than this, in CSS pixels, is a click rather than a frame. */
const MINIMUM_DRAG = 6;

type Gesture =
  | { kind: 'draw'; from: { x: number; y: number }; to: { x: number; y: number } }
  | { kind: 'adjust'; handle: FrameHandle; start: { x: number; y: number }; box: ScreenBox };

/**
 * The crop frame, drawn over the page.
 *
 * Dragging on the page draws a frame; dragging the frame moves it, and its
 * handles move an edge or a corner. What lies outside the frame is dimmed,
 * so the reader sees what the page will show before anything changes.
 */
export function CropLayer({
  geometry,
  scale,
  rotation,
  frame,
  onChange,
}: CropLayerProps): ReactElement {
  const layerRef = useRef<HTMLDivElement>(null);
  const [gesture, setGesture] = useState<Gesture | null>(null);

  const bounds = (): { width: number; height: number } => {
    const box = layerRef.current?.getBoundingClientRect();
    return { width: box?.width ?? 0, height: box?.height ?? 0 };
  };

  const localOf = (event: PointerEvent<HTMLElement>): { x: number; y: number } => {
    const box = layerRef.current?.getBoundingClientRect();
    return { x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0) };
  };

  const committed = frame === null ? null : pdfRectToCss(frame, geometry, scale, rotation);

  const shown: ScreenBox | null = (() => {
    if (gesture === null) return committed;
    if (gesture.kind === 'draw') {
      return {
        left: Math.min(gesture.from.x, gesture.to.x),
        top: Math.min(gesture.from.y, gesture.to.y),
        width: Math.abs(gesture.to.x - gesture.from.x),
        height: Math.abs(gesture.to.y - gesture.from.y),
      };
    }
    return gesture.box;
  })();

  const commit = (box: ScreenBox): void => {
    onChange(cssRectToPdf(box, geometry, scale, rotation));
  };

  const onLayerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = localOf(event);
    setGesture({ kind: 'draw', from: point, to: point });
  };

  const onHandleDown = (event: PointerEvent<HTMLElement>, handle: FrameHandle): void => {
    if (event.button !== 0 || committed === null) return;
    event.preventDefault();
    event.stopPropagation();
    layerRef.current?.setPointerCapture(event.pointerId);
    setGesture({ kind: 'adjust', handle, start: localOf(event), box: committed });
  };

  const onMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (gesture === null) return;
    const point = localOf(event);
    if (gesture.kind === 'draw') {
      setGesture({ ...gesture, to: point });
      return;
    }
    if (committed === null) return;
    const box = adjustFrame(
      committed,
      gesture.handle,
      point.x - gesture.start.x,
      point.y - gesture.start.y,
      bounds(),
    );
    setGesture({ ...gesture, box });
  };

  const onUp = (event: PointerEvent<HTMLDivElement>): void => {
    if (gesture === null) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setGesture(null);
    if (shown === null) return;

    if (gesture.kind === 'draw') {
      if (shown.width < MINIMUM_DRAG || shown.height < MINIMUM_DRAG) return;
      const area = bounds();
      // A frame dragged past the edge of the page stops at the edge.
      const left = Math.max(0, shown.left);
      const top = Math.max(0, shown.top);
      commit({
        left,
        top,
        width: Math.min(area.width, shown.left + shown.width) - left,
        height: Math.min(area.height, shown.top + shown.height) - top,
      });
      return;
    }
    commit(shown);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (committed === null) return;
    const step = event.shiftKey ? 10 : 1;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = moves[event.key];
    if (move === undefined) return;
    event.preventDefault();
    commit(adjustFrame(committed, 'move', move[0], move[1], bounds()));
  };

  return (
    <div
      ref={layerRef}
      className={styles.layer}
      data-crop-layer=""
      onPointerDown={onLayerDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      {shown !== null && shown.width > 0 && shown.height > 0 && (
        <>
          <div className={styles.shade} style={cssBoxStyle(shown)} aria-hidden="true" />
          <div
            className={styles.frame}
            style={cssBoxStyle(shown)}
            role="group"
            tabIndex={0}
            aria-label="Crop frame. Drag to move it, or use the arrow keys."
            data-crop-frame=""
            onPointerDown={(event) => onHandleDown(event, 'move')}
            onKeyDown={onKeyDown}
          >
            {HANDLES.map((handle) => (
              <span
                key={handle}
                className={styles.handle}
                data-handle={handle}
                title={`Drag the ${HANDLE_NAMES[handle]}`}
                onPointerDown={(event) => onHandleDown(event, handle)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
