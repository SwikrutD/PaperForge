import { useRef, useState, type PointerEvent, type ReactElement } from 'react';
import type { PdfPageGeometry } from '@pdf/render/types';
import type { FormFieldModel, FormFieldType } from '@shared/schemas/form';
import { cx } from '../../utils/classNames';
import { cssPointToPdf, cssRectToPdf, pdfRectToCss } from '../viewer/pageGeometry';
import { HANDLES, movedBy, resizedBy, type Handle } from '../edit/imageGeometry';
import type { FieldRect } from '../../stores/formStore';
import styles from './FieldDesignLayer.module.css';

interface FieldDesignLayerProps {
  geometry: PdfPageGeometry;
  scale: number;
  rotation: number;
  widgets: ReadonlyArray<{ field: FormFieldModel; widgetIndex: number }>;
  selected: string | null;
  /** Where the field being dragged is now, before it is written. */
  drag: { name: string; rect: FieldRect } | null;
  /** The kind of field the next drag draws, when one has been chosen. */
  tool: FormFieldType | null;
  onSelect: (name: string | null) => void;
  onDrag: (name: string, rect: FieldRect) => void;
  onDrop: (name: string, rect: FieldRect) => void;
  /** The box the reader has just drawn for a new field. */
  onDraw: (rect: FieldRect) => void;
}

interface Gesture {
  name: string;
  from: { x: number; y: number };
  start: FieldRect;
  handle: Handle | null;
  rect: FieldRect;
}

const MINIMUM_DRAW = 8;

const LABELS: Record<FormFieldType, string> = {
  text: 'Text',
  checkbox: 'Checkbox',
  radio: 'Radio',
  dropdown: 'Dropdown',
  optionList: 'List',
  button: 'Button',
  signature: 'Signature',
};

/**
 * The form as something to build: every field is a box to move, resize or
 * take away, and dragging on the page draws a new one.
 *
 * Nothing here is filled in — a field being made is a shape and a name, and
 * what it will hold is what the panel beside it says.
 */
export function FieldDesignLayer({
  geometry,
  scale,
  rotation,
  widgets,
  selected,
  drag,
  tool,
  onSelect,
  onDrag,
  onDrop,
  onDraw,
}: FieldDesignLayerProps): ReactElement {
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

  const localOf = (event: PointerEvent<HTMLElement>): { x: number; y: number } => {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };

  const begin = (
    event: PointerEvent<HTMLElement>,
    field: FormFieldModel,
    rect: FieldRect,
    handle: Handle | null,
  ): void => {
    if (tool !== null) return;
    event.stopPropagation();
    event.preventDefault();
    if (selected !== field.name) onSelect(field.name);

    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { name: field.name, from: pointOf(event), start: rect, handle, rect };
  };

  const move = (event: PointerEvent<HTMLElement>): void => {
    const current = gesture.current;
    if (current === null) return;

    const point = pointOf(event);
    const placement = { ...current.start, rotation: 0, flipX: false, flipY: false };
    const next =
      current.handle === null
        ? movedBy(placement, point.x - current.from.x, point.y - current.from.y)
        : resizedBy(placement, current.handle, point.x - current.from.x, point.y - current.from.y);

    current.rect = { x: next.x, y: next.y, width: next.width, height: next.height };
    onDrag(current.name, current.rect);
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
    if (!same) onDrop(current.name, current.rect);
  };

  const onBackgroundDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (tool === null) {
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
    // A click that did not travel makes a field of a usual size instead.
    const drawn =
      box.width < MINIMUM_DRAW || box.height < MINIMUM_DRAW
        ? { left: box.left, top: box.top, width: 140 * scale, height: 22 * scale }
        : box;
    onDraw(cssRectToPdf(drawn, geometry, scale, rotation));
  };

  return (
    <div
      className={cx(styles.layer, tool !== null && styles.drawing)}
      data-field-design={tool ?? 'select'}
      onPointerDown={onBackgroundDown}
      onPointerMove={onBackgroundMove}
      onPointerUp={onBackgroundUp}
      onPointerCancel={onBackgroundUp}
    >
      {widgets.map(({ field, widgetIndex }) => {
        const widget = field.widgets[widgetIndex];
        if (widget === undefined) return null;
        const rect = drag?.name === field.name && widgetIndex === 0 ? drag.rect : widget.rect;
        const box = pdfRectToCss(rect, geometry, scale, rotation);
        if (box === null) return null;

        const isSelected = selected === field.name;
        return (
          <div
            key={`${field.name}:${String(widgetIndex)}`}
            className={cx(styles.field, isSelected && styles.selected)}
            style={{
              left: `${String(box.left)}px`,
              top: `${String(box.top)}px`,
              width: `${String(box.width)}px`,
              height: `${String(box.height)}px`,
            }}
            data-design-field={field.name}
            data-selected={isSelected ? 'true' : 'false'}
            title={`${field.name} · ${LABELS[field.type]}`}
            onPointerDown={(event) => begin(event, field, rect, null)}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
          >
            <span className={styles.name}>{field.name}</span>
            {isSelected &&
              widgetIndex === 0 &&
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
                  onPointerDown={(event) => begin(event, field, rect, handle)}
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
          data-field-sketch="true"
        />
      )}
    </div>
  );
}
