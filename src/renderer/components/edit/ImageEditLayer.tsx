import { useEffect, useRef, type PointerEvent, type ReactElement } from 'react';
import type { PdfPageGeometry } from '@pdf/render/types';
import type { ImagePlacementInput } from '@shared/schemas/edit';
import type { PageImageModel } from '@shared/schemas/image';
import { cx } from '../../utils/classNames';
import { cssPointToPdf } from '../viewer/pageGeometry';
import { awaitingPaint, usePaintedRevision } from '../viewer/paintedRevision';
import type { MovedImage } from '../../stores/imageEditStore';
import { HANDLES, movedBy, resizedBy, type Handle } from './imageGeometry';
import { frameStyle, imageFrame, snapshotImage } from './imageFrame';
import { MovedImageMark } from './MovedImageMark';
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
  /** An image on this page just moved or deleted, until the page is drawn with it. */
  moved?: MovedImage | null;
  /** Called once the page's picture shows the moved image itself. */
  onSettle?: () => void;
  onSelect: (id: string | null) => void;
  onDrag: (id: string, placement: ImagePlacementInput) => void;
  /** `picture` is the image as the page shows it, to stand in until it is redrawn. */
  onDrop: (id: string, placement: ImagePlacementInput, picture: HTMLCanvasElement | null) => void;
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
  moved = null,
  onSettle,
  onSelect,
  onDrag,
  onDrop,
  onPlace,
}: ImageEditLayerProps): ReactElement {
  const gesture = useRef<Gesture | null>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const painted = usePaintedRevision();
  const showMoved = moved !== null && awaitingPaint(moved.madeIn, painted);

  // Once the picture has the image where it now is, the picture shows it.
  useEffect(() => {
    if (moved !== null && !awaitingPaint(moved.madeIn, painted)) onSettle?.();
  }, [moved, painted, onSettle]);

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

    if (samePlacement(current.placement, current.start)) return;

    // The page still draws the image where it was: copy it from there now, to
    // show where it goes until the page is drawn again.
    const frame = imageFrame(current.start, geometry, scale, rotation);
    const picture =
      frame === null || layerRef.current === null ? null : snapshotImage(layerRef.current, frame);
    onDrop(current.id, current.placement, picture);
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
      ref={layerRef}
      className={cx(styles.layer, placing && styles.placing)}
      data-image-layer={placing ? 'placing' : 'editing'}
      onPointerDown={onBackground}
    >
      {showMoved && (
        <MovedImageMark moved={moved} geometry={geometry} scale={scale} rotation={rotation} />
      )}

      {images.map((image) => {
        // A deleted image keeps no box while the page still draws it.
        if (showMoved && moved.to === null && samePlacement(moved.from, image.placement)) {
          return null;
        }
        const placement = drag?.id === image.id ? drag.placement : image.placement;
        // The box is placed upright and then turned, so the handles keep to
        // the image's own corners however far round it is.
        const frame = imageFrame(placement, geometry, scale, rotation);
        if (frame === null) return null;
        const selected = image.id === selectedId;

        return (
          <div
            key={image.id}
            className={cx(styles.image, selected && styles.selected)}
            style={frameStyle(frame)}
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

function samePlacement(left: ImagePlacementInput, right: ImagePlacementInput): boolean {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
}
