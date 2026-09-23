import { useRef, useState, type PointerEvent, type ReactElement } from 'react';
import type { PdfPageGeometry } from '@pdf/render/types';
import type { LinkModel, LinkRect } from '@shared/schemas/link';
import { cx } from '../../utils/classNames';
import { cssPointToPdf, cssRectToPdf, pdfRectToCss } from '../viewer/pageGeometry';
import { HANDLES, movedBy, resizedBy, type Handle } from './imageGeometry';
import styles from './LinkEditLayer.module.css';

interface LinkEditLayerProps {
  geometry: PdfPageGeometry;
  scale: number;
  rotation: number;
  links: readonly LinkModel[];
  selectedId: string | null;
  /** Where the link being dragged is right now, before it is written. */
  drag: { id: string; rect: LinkRect } | null;
  /** True while the reader is drawing the area a new link will cover. */
  drawing: boolean;
  onSelect: (id: string | null) => void;
  onDrag: (id: string, rect: LinkRect) => void;
  onDrop: (id: string, rect: LinkRect) => void;
  /** The area the reader has just drawn for a new link. */
  onDraw: (rect: LinkRect) => void;
}

interface Gesture {
  id: string;
  from: { x: number; y: number };
  start: LinkRect;
  handle: Handle | null;
  rect: LinkRect;
}

/** The smallest link worth making, in CSS pixels. */
const MINIMUM_DRAW = 6;

/**
 * The links of a page, as areas to point at.
 *
 * Every link gets a box: click one to work on it, drag it or its handles to
 * change the area it covers. While the reader is making a link, dragging on
 * the page draws the area the new one will cover.
 */
export function LinkEditLayer({
  geometry,
  scale,
  rotation,
  links,
  selectedId,
  drag,
  drawing,
  onSelect,
  onDrag,
  onDrop,
  onDraw,
}: LinkEditLayerProps): ReactElement {
  const gesture = useRef<Gesture | null>(null);
  const [sketch, setSketch] = useState<{
    from: { x: number; y: number };
    to: { x: number; y: number };
  } | null>(null);

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

  /** A point on the layer in its own pixels, for drawing a new area. */
  const localOf = (event: PointerEvent<HTMLElement>): { x: number; y: number } => {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };

  const begin = (
    event: PointerEvent<HTMLElement>,
    link: LinkModel,
    handle: Handle | null,
  ): void => {
    if (drawing) return;
    event.stopPropagation();
    event.preventDefault();
    if (selectedId !== link.id) onSelect(link.id);

    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = {
      id: link.id,
      from: pointOf(event),
      start: link.rect,
      handle,
      rect: link.rect,
    };
  };

  const move = (event: PointerEvent<HTMLElement>): void => {
    const current = gesture.current;
    if (current === null) return;

    const point = pointOf(event);
    const dx = point.x - current.from.x;
    const dy = point.y - current.from.y;
    const placement = { ...current.start, rotation: 0, flipX: false, flipY: false };
    const next =
      current.handle === null
        ? movedBy(placement, dx, dy)
        : resizedBy(placement, current.handle, dx, dy);

    current.rect = { x: next.x, y: next.y, width: next.width, height: next.height };
    onDrag(current.id, current.rect);
  };

  const end = (event: PointerEvent<HTMLElement>): void => {
    const current = gesture.current;
    gesture.current = null;
    if (current === null) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const same =
      current.rect.x === current.start.x &&
      current.rect.y === current.start.y &&
      current.rect.width === current.start.width &&
      current.rect.height === current.start.height;
    if (!same) onDrop(current.id, current.rect);
  };

  const onBackgroundDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (!drawing) {
      if (event.target === event.currentTarget) onSelect(null);
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = localOf(event);
    setSketch({ from: point, to: point });
  };

  const onBackgroundMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (sketch === null) return;
    setSketch({ from: sketch.from, to: localOf(event) });
  };

  const onBackgroundUp = (event: PointerEvent<HTMLDivElement>): void => {
    if (sketch === null) return;
    const to = localOf(event);
    setSketch(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const box = {
      left: Math.min(sketch.from.x, to.x),
      top: Math.min(sketch.from.y, to.y),
      width: Math.abs(to.x - sketch.from.x),
      height: Math.abs(to.y - sketch.from.y),
    };
    // A click that did not travel is not an area.
    if (box.width < MINIMUM_DRAW || box.height < MINIMUM_DRAW) return;
    onDraw(cssRectToPdf(box, geometry, scale, rotation));
  };

  return (
    <div
      className={cx(styles.layer, drawing && styles.drawing)}
      data-link-layer={drawing ? 'drawing' : 'editing'}
      onPointerDown={onBackgroundDown}
      onPointerMove={onBackgroundMove}
      onPointerUp={onBackgroundUp}
      onPointerCancel={onBackgroundUp}
    >
      {links.map((link) => {
        const rect = drag?.id === link.id ? drag.rect : link.rect;
        const box = pdfRectToCss(rect, geometry, scale, rotation);
        if (box === null) return null;
        const selected = link.id === selectedId;

        return (
          <div
            key={link.id}
            className={cx(styles.link, selected && styles.selected)}
            style={{
              left: `${String(box.left)}px`,
              top: `${String(box.top)}px`,
              width: `${String(box.width)}px`,
              height: `${String(box.height)}px`,
            }}
            data-link={link.id}
            data-selected={selected ? 'true' : 'false'}
            title={describe(link)}
            onPointerDown={(event) => begin(event, link, null)}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
          >
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
                  onPointerDown={(event) => begin(event, link, handle)}
                  onPointerMove={move}
                  onPointerUp={end}
                  onPointerCancel={end}
                />
              ))}
          </div>
        );
      })}

      {sketch !== null && (
        <div
          className={styles.sketch}
          style={{
            left: `${String(Math.min(sketch.from.x, sketch.to.x))}px`,
            top: `${String(Math.min(sketch.from.y, sketch.to.y))}px`,
            width: `${String(Math.abs(sketch.to.x - sketch.from.x))}px`,
            height: `${String(Math.abs(sketch.to.y - sketch.from.y))}px`,
          }}
          data-link-sketch="true"
        />
      )}
    </div>
  );
}

/** What a link points at, in a few words for a tooltip. */
function describe(link: LinkModel): string {
  if (link.target.kind === 'url') return link.target.url;
  if (link.target.kind === 'page') return `Page ${String(link.target.page)}`;
  return link.target.description;
}
