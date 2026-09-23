import { useRef, type PointerEvent, type ReactElement } from 'react';
import type { PdfPageGeometry } from '@pdf/render/types';
import type { ImagePlacementInput } from '@shared/schemas/edit';
import type { PageImageModel } from '@shared/schemas/image';
import { cx } from '../../utils/classNames';
import { cssPointToPdf, pdfRectToCss, quarterTurns } from '../viewer/pageGeometry';
import { HANDLES, movedBy, resizedBy, type Handle } from './imageGeometry';
import styles from './ImageEditLayer.module.css';

interface ImageEditLayerProps {
  geometry: PdfPageGeometry;
  scale: number;
  /** The reader's view rotation, on top of the page's own. */
  rotation: number;
  images: readonly PageImageModel[];
  selectedId: string | null;
  /** Where the image being dragged is right now, before it is written. */
  drag: { id: string; placement: ImagePlacementInput } | null;
  /** True while the reader is choosing where a new image goes. */
  placing: boolean;
  onSelect: (id: string | null) => void;
  onDrag: (id: string, placement: ImagePlacementInput) => void;
  onDrop: (id: string, placement: ImagePlacementInput) => void;
  /** A click on the page, while an image is waiting to be placed. */
  onPlace: (x: number, y: number) => void;
}

interface Gesture {
  id: string;
  from: { x: number; y: number };
  start: ImagePlacementInput;
  handle: Handle | null;
  placement: ImagePlacementInput;
}

/**
 * The images of a page, as things to point at.
 *
 * Each image gets a box where it is drawn; the selected one grows handles.
 * Dragging the box moves the image and dragging a handle resizes it, both in
 * the image's own axes, so a picture that sits at an angle behaves the way it
 * looks. Nothing is written until the drag ends: one drag is one undo.
 */
export function ImageEditLayer({
  geometry,
  scale,
  rotation,
  images,
  selectedId,
  drag,
  placing,
  onSelect,
  onDrag,
  onDrop,
  onPlace,
}: ImageEditLayerProps): ReactElement {
  const gesture = useRef<Gesture | null>(null);
  const turns = quarterTurns(geometry.rotation + rotation);

  /** A point on this layer, in PDF user space. */
  const pointOf = (event: PointerEvent<HTMLElement>): { x: number; y: number } => {
    const layer = event.currentTarget.closest(`.${styles.layer}`) ?? event.currentTarget;
    const box = layer.getBoundingClientRect();
    return cssPointToPdf(
      { x: event.clientX - box.left, y: event.clientY - box.top },
      geometry,
      scale,
      rotation,
    );
  };

  const begin = (
    event: PointerEvent<HTMLElement>,
    image: PageImageModel,
    handle: Handle | null,
  ): void => {
    event.stopPropagation();
    // The page column takes focus on pointer down, which would end the gesture
    // before it started.
    event.preventDefault();
    if (selectedId !== image.id) onSelect(image.id);

    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = {
      id: image.id,
      from: pointOf(event),
      start: image.placement,
      handle,
      placement: image.placement,
    };
  };

  const move = (event: PointerEvent<HTMLElement>): void => {
    const current = gesture.current;
    if (current === null) return;

    const point = pointOf(event);
    const dx = point.x - current.from.x;
    const dy = point.y - current.from.y;
    const placement =
      current.handle === null
        ? movedBy(current.start, dx, dy)
        : resizedBy(current.start, current.handle, dx, dy, event.shiftKey);

    current.placement = placement;
    onDrag(current.id, placement);
  };

  const end = (event: PointerEvent<HTMLElement>): void => {
    const current = gesture.current;
    gesture.current = null;
    if (current === null) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const same =
      current.placement.x === current.start.x &&
      current.placement.y === current.start.y &&
      current.placement.width === current.start.width &&
      current.placement.height === current.start.height;
    if (same) return;
    onDrop(current.id, current.placement);
  };

  const onBackground = (event: PointerEvent<HTMLDivElement>): void => {
    if (placing) {
      event.preventDefault();
      const point = pointOf(event);
      onPlace(point.x, point.y);
      return;
    }
    if (event.target === event.currentTarget) onSelect(null);
  };

  return (
    <div
      className={cx(styles.layer, placing && styles.placing)}
      data-image-layer={placing ? 'placing' : 'editing'}
      onPointerDown={onBackground}
    >
      {images.map((image) => {
        const placement = drag?.id === image.id ? drag.placement : image.placement;
        const box = pdfRectToCss(placement, geometry, scale, rotation);
        if (box === null) return null;

        // The box is placed upright and then turned, so the handles keep to
        // the image's own corners however far round it is.
        const width = turns % 2 === 0 ? box.width : box.height;
        const height = turns % 2 === 0 ? box.height : box.width;
        const centre = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
        const selected = image.id === selectedId;
        const degrees = turns * 90 - placement.rotation;

        return (
          <div
            key={image.id}
            className={cx(styles.image, selected && styles.selected)}
            style={{
              left: `${String(centre.x - width / 2)}px`,
              top: `${String(centre.y - height / 2)}px`,
              width: `${String(width)}px`,
              height: `${String(height)}px`,
              transform: `rotate(${String(degrees)}deg)${placement.flipX ? ' scaleX(-1)' : ''}`,
            }}
            data-image={image.id}
            data-selected={selected ? 'true' : 'false'}
            title={`${String(image.pixelWidth)} × ${String(image.pixelHeight)} pixels`}
            onPointerDown={(event) => {
              if (placing) return;
              begin(event, image, null);
            }}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
          >
            <span className={styles.frame} aria-hidden="true" />
            {selected &&
              HANDLES.map(({ handle, label, cursor }) => (
                <span
                  key={label}
                  className={styles.handle}
                  role="presentation"
                  aria-label={`${label} handle`}
                  style={{
                    left: `${String(handle.x * 100)}%`,
                    top: `${String((1 - handle.y) * 100)}%`,
                    cursor,
                  }}
                  data-handle={label}
                  onPointerDown={(event) => {
                    if (placing) return;
                    begin(event, image, handle);
                  }}
                  onPointerMove={move}
                  onPointerUp={end}
                  onPointerCancel={end}
                />
              ))}
          </div>
        );
      })}
    </div>
  );
}
