import { useRef, type PointerEvent, type ReactElement } from 'react';
import type { ImagePlacementInput } from '@shared/schemas/edit';
import { cropDraggedBy, HANDLES, type Handle, type ImageCrop } from './imageGeometry';
import styles from './ImageEditLayer.module.css';

interface ImageCropFrameProps {
  /** The image's box; the crop is drawn inside it. */
  placement: ImagePlacementInput;
  crop: ImageCrop;
  /** A pointer position in PDF user space. */
  pointOf: (event: PointerEvent<HTMLElement>) => { x: number; y: number };
  onChange: (crop: ImageCrop) => void;
}

interface CropGesture {
  from: { x: number; y: number };
  start: ImageCrop;
  /** Null drags the whole crop about inside the picture. */
  handle: Handle | null;
}

/**
 * The crop of a selected image, on the page: what will be hidden is shaded,
 * and the part that will show has a handle on each corner and edge. Dragging
 * inside it moves it about the picture.
 *
 * It sits on the image's unmirrored box, so the crop is laid out as the reader
 * sees it; `cropDraggedBy` turns drags into the image's own square.
 */
export function ImageCropFrame({
  placement,
  crop,
  pointOf,
  onChange,
}: ImageCropFrameProps): ReactElement {
  const gesture = useRef<CropGesture | null>(null);

  // On the box, a mirrored picture's crop starts from the other side.
  const left = placement.flipX ? 1 - crop.x - crop.width : crop.x;
  const top = 1 - crop.y - crop.height;

  const begin = (event: PointerEvent<HTMLElement>, handle: Handle | null): void => {
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { from: pointOf(event), start: crop, handle };
  };

  const move = (event: PointerEvent<HTMLElement>): void => {
    const current = gesture.current;
    if (current === null) return;
    const point = pointOf(event);
    onChange(
      cropDraggedBy(
        placement,
        current.start,
        current.handle,
        point.x - current.from.x,
        point.y - current.from.y,
      ),
    );
  };

  const end = (event: PointerEvent<HTMLElement>): void => {
    gesture.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const percent = (value: number): string => `${String(value * 100)}%`;

  return (
    <span
      className={styles.cropArea}
      data-crop="true"
      style={{
        left: percent(left),
        top: percent(top),
        width: percent(crop.width),
        height: percent(crop.height),
      }}
      onPointerDown={(event) => begin(event, null)}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    >
      {HANDLES.map(({ handle, label, cursor }) => (
        <span
          key={label}
          className={cx(handle)}
          role="presentation"
          aria-label={`Crop ${label.toLowerCase()} handle`}
          data-crop-handle={label}
          style={{
            left: percent(handle.x),
            top: percent(1 - handle.y),
            cursor,
          }}
          onPointerDown={(event) => begin(event, handle)}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        />
      ))}
    </span>
  );
}

/** Corners are drawn as brackets and edges as bars, as crop handles usually are. */
function cx(handle: Handle): string {
  const corner = handle.x !== 0.5 && handle.y !== 0.5;
  return `${styles.cropHandle ?? ''} ${corner ? (styles.cropCorner ?? '') : (styles.cropEdge ?? '')}`;
}
