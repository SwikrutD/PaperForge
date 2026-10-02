import { useState, type KeyboardEvent, type PointerEvent, type ReactElement } from 'react';
import type { PdfPageGeometry } from '@pdf/render/types';
import type { RedactionRect } from '@shared/schemas/redaction';
import type { PendingMark, RedactionTool } from '../../stores/redactionStore';
import { cx } from '../../utils/classNames';
import { cssRectToPdf, pdfRectToCss } from '../viewer/pageGeometry';
import styles from './RedactionLayer.module.css';

interface RedactionLayerProps {
  geometry: PdfPageGeometry;
  scale: number;
  rotation: number;
  marks: readonly PendingMark[];
  selectedId: string | null;
  tool: RedactionTool;
  onSelect: (id: string | null) => void;
  onRemove: (id: string) => void;
  /** An area the reader has just dragged out. */
  onDraw: (rect: RedactionRect) => void;
}

/** A drag shorter than this, in CSS pixels, is a click rather than an area. */
const MINIMUM_DRAG = 4;

/**
 * The marks waiting to be applied, drawn over the page.
 *
 * They are outlined rather than filled, so the reader can still see what
 * each one covers: nothing is removed until the marks are applied. With the
 * area tool, dragging on the page draws a new mark; with the text tool the
 * page's text stays selectable underneath and only the marks take a click.
 */
export function RedactionLayer({
  geometry,
  scale,
  rotation,
  marks,
  selectedId,
  tool,
  onSelect,
  onRemove,
  onDraw,
}: RedactionLayerProps): ReactElement {
  const [sketch, setSketch] = useState<{
    from: { x: number; y: number };
    to: { x: number; y: number };
  } | null>(null);

  const localOf = (event: PointerEvent<HTMLElement>): { x: number; y: number } => {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };

  const onDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (tool !== 'area' || event.target !== event.currentTarget || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = localOf(event);
    setSketch({ from: point, to: point });
    onSelect(null);
  };

  const onMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (sketch !== null) setSketch({ from: sketch.from, to: localOf(event) });
  };

  const onUp = (event: PointerEvent<HTMLDivElement>): void => {
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
    if (box.width < MINIMUM_DRAG || box.height < MINIMUM_DRAG) return;
    onDraw(cssRectToPdf(box, geometry, scale, rotation));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, id: string): void => {
    if (event.key !== 'Delete' && event.key !== 'Backspace') return;
    event.preventDefault();
    onRemove(id);
  };

  return (
    <div
      className={cx(styles.layer, tool === 'area' && styles.drawing)}
      data-redaction-tool={tool}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      {marks.map((mark) =>
        mark.rects.map((rect, index) => {
          const box = pdfRectToCss(rect, geometry, scale, rotation);
          if (box === null) return null;
          const selected = selectedId === mark.id;
          return (
            <button
              key={`${mark.id}:${String(index)}`}
              type="button"
              className={cx(styles.mark, selected && styles.selected)}
              style={{
                left: `${String(box.left)}px`,
                top: `${String(box.top)}px`,
                width: `${String(box.width)}px`,
                height: `${String(box.height)}px`,
              }}
              aria-label={`Marked for redaction: ${mark.label}`}
              aria-pressed={selected}
              title={`${mark.label}${mark.reason === null ? '' : ` — ${mark.reason}`}\nDelete removes the mark.`}
              data-redaction-mark={mark.id}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => onSelect(mark.id)}
              onKeyDown={(event) => onKeyDown(event, mark.id)}
            >
              {index === 0 && mark.reason !== null && (
                <span className={styles.reason}>{mark.reason}</span>
              )}
            </button>
          );
        }),
      )}

      {sketch !== null && (
        <div
          className={styles.sketch}
          style={{
            left: `${String(Math.min(sketch.from.x, sketch.to.x))}px`,
            top: `${String(Math.min(sketch.from.y, sketch.to.y))}px`,
            width: `${String(Math.abs(sketch.to.x - sketch.from.x))}px`,
            height: `${String(Math.abs(sketch.to.y - sketch.from.y))}px`,
          }}
        />
      )}
    </div>
  );
}
