import { useRef, useState, type PointerEvent, type ReactElement } from 'react';
import { Copy } from 'lucide-react';
import type { PdfPageGeometry } from '@pdf/render/types';
import type { Annotation } from '@shared/schemas/annotation';
import type { ImagePlacementInput } from '@shared/schemas/edit';
import { cssPointToPdf } from '../viewer/pageGeometry';
import { HANDLES, resizeGesture, rotatedTo, type Handle } from '../edit/imageGeometry';
import { frameStyle, imageFrame } from '../edit/imageFrame';
import styles from './AnnotationLayer.module.css';

interface StampTransformFrameProps {
  annotation: Annotation;
  geometry: PdfPageGeometry;
  scale: number;
  rotation: number;
  /** The stamp's new upright box and turn, once a drag ends. */
  onTransform: (
    annotation: Annotation,
    rect: { x: number; y: number; width: number; height: number },
    rotation: number,
  ) => void;
  onDuplicate: (annotation: Annotation) => void;
}

interface Gesture {
  from: { x: number; y: number };
  start: ImagePlacementInput;
  /** Null turns the stamp; a handle resizes it. */
  handle: Handle | null;
}

/**
 * Handles on a selected stamp or signature PaperForge made: the corners and
 * edges resize it (a corner keeps its shape unless Shift is held), the handle
 * above it turns it (in 15° steps with Shift), and a button copies it.
 *
 * The frame follows the drag; the stamp itself is written once, when the
 * pointer comes up, so one drag is one undo. Moving it is still done by
 * dragging the stamp itself.
 */
export function StampTransformFrame({
  annotation,
  geometry,
  scale,
  rotation,
  onTransform,
  onDuplicate,
}: StampTransformFrameProps): ReactElement | null {
  const gesture = useRef<Gesture | null>(null);
  const [live, setLive] = useState<ImagePlacementInput | null>(null);
  if (!('rect' in annotation.geometry)) return null;

  const placed: ImagePlacementInput = {
    ...annotation.geometry.rect,
    rotation: annotation.rotation ?? 0,
    flipX: false,
    flipY: false,
  };
  const placement = live ?? placed;
  const frame = imageFrame(placement, geometry, scale, rotation);
  if (frame === null) return null;

  const pointOf = (event: PointerEvent<HTMLElement>): { x: number; y: number } => {
    const layer = event.currentTarget.closest('[data-annotation-layer]') ?? event.currentTarget;
    const box = layer.getBoundingClientRect();
    return cssPointToPdf(
      { x: event.clientX - box.left, y: event.clientY - box.top },
      geometry,
      scale,
      rotation,
    );
  };

  const begin = (event: PointerEvent<HTMLElement>, handle: Handle | null): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { from: pointOf(event), start: placed, handle };
  };

  const move = (event: PointerEvent<HTMLElement>): void => {
    const current = gesture.current;
    if (current === null) return;
    event.stopPropagation();
    const point = pointOf(event);
    setLive(
      current.handle === null
        ? rotatedTo(current.start, current.from, point, event.shiftKey)
        : resizeGesture(
            current.start,
            current.handle,
            point.x - current.from.x,
            point.y - current.from.y,
            event.shiftKey,
          ),
    );
  };

  const end = (event: PointerEvent<HTMLElement>): void => {
    const current = gesture.current;
    gesture.current = null;
    if (current === null) return;
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const final = live;
    setLive(null);
    if (final === null || samePlacement(final, current.start)) return;
    onTransform(
      annotation,
      { x: final.x, y: final.y, width: final.width, height: final.height },
      final.rotation,
    );
  };

  return (
    <div className={styles.stampFrame} style={frameStyle(frame)} data-stamp-frame>
      <span className={styles.rotateStem} aria-hidden="true" />
      <span
        className={`${styles.stampHandle} ${styles.rotateHandle}`}
        role="presentation"
        aria-label="Rotate handle"
        data-stamp-handle="Rotate"
        onPointerDown={(event) => begin(event, null)}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      />
      {HANDLES.map(({ handle, label, cursor }) => (
        <span
          key={label}
          className={styles.stampHandle}
          role="presentation"
          aria-label={`${label} handle`}
          data-stamp-handle={label}
          style={{
            left: `${String(handle.x * 100)}%`,
            top: `${String((1 - handle.y) * 100)}%`,
            cursor,
          }}
          onPointerDown={(event) => begin(event, handle)}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        />
      ))}
      <button
        type="button"
        className={styles.duplicate}
        aria-label="Duplicate"
        title="Duplicate"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => onDuplicate(annotation)}
      >
        <Copy size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

function samePlacement(left: ImagePlacementInput, right: ImagePlacementInput): boolean {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height &&
    left.rotation === right.rotation
  );
}
