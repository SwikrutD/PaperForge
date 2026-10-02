import { useRef, useState, type PointerEvent, type ReactElement } from 'react';
import type { PdfPageGeometry } from '@pdf/render/types';
import type { AnnotationPoint } from '@shared/schemas/annotation';
import { actualSizeScale, formatMeasurement, measure } from '@shared/utils/measure';
import { useMeasureStore } from '../../stores/measureStore';
import { cssPointToPdf, pdfRectToCss } from '../viewer/pageGeometry';
import styles from './MeasureLayer.module.css';

/** Two presses this close in time and place are a double click. */
const DOUBLE_CLICK_MS = 450;
const DOUBLE_CLICK_SLOP = 5;

interface MeasureLayerProps {
  sessionId: string;
  geometry: PdfPageGeometry;
  scale: number;
  rotation: number;
}

/**
 * Where a measurement is drawn: a click for each point, the shape and its
 * value following the pointer, a double click to finish. Shift keeps the
 * next segment level, upright or on the diagonal.
 */
export function MeasureLayer({
  sessionId,
  geometry,
  scale,
  rotation,
}: MeasureLayerProps): ReactElement {
  const layerRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<AnnotationPoint | null>(null);
  const lastPress = useRef<{ time: number; x: number; y: number } | null>(null);
  const tool = useMeasureStore((state) => state.tool);
  const draft = useMeasureStore((state) =>
    state.draft?.sessionId === sessionId && state.draft.page === geometry.pageNumber
      ? state.draft
      : null,
  );
  // Selected as parts: the actual-size scale is a new object every time it is made.
  const calibrated = useMeasureStore((state) => state.scales[sessionId]);
  const unit = useMeasureStore((state) => state.unit);
  const measureScale = calibrated ?? actualSizeScale(unit);

  const toPdf = (event: PointerEvent): AnnotationPoint => {
    const bounds = layerRef.current?.getBoundingClientRect();
    const point = cssPointToPdf(
      { x: event.clientX - (bounds?.left ?? 0), y: event.clientY - (bounds?.top ?? 0) },
      geometry,
      scale,
      rotation,
    );
    const last = draft?.points[draft.points.length - 1];
    return event.shiftKey && last !== undefined ? constrain(last, point) : point;
  };

  const toCss = (point: AnnotationPoint): { x: number; y: number } => {
    const box = pdfRectToCss(
      { x: point.x, y: point.y, width: 0.001, height: 0.001 },
      geometry,
      scale,
      rotation,
    );
    return { x: box?.left ?? 0, y: box?.top ?? 0 };
  };

  const points = draft === null ? [] : [...draft.points, ...(hover === null ? [] : [hover])];
  const cssPoints = points.map(toCss);
  const closed = tool === 'area' && points.length >= 3;
  const kind = tool === 'calibrate' ? 'distance' : tool;
  const value = points.length >= 2 ? measure(kind, points, measureScale) : null;
  const label =
    value === null
      ? null
      : tool === 'calibrate'
        ? 'Calibration line'
        : formatMeasurement(value, kind, measureScale.unit);
  const anchor = cssPoints[cssPoints.length - 1];

  return (
    <div
      ref={layerRef}
      className={styles.layer}
      data-measure-layer={geometry.pageNumber}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        const store = useMeasureStore.getState();
        // A second press in the same place, quickly, is a double click: it
        // finishes the shape rather than adding the same corner twice.
        const previous = lastPress.current;
        const now = { time: event.timeStamp, x: event.clientX, y: event.clientY };
        lastPress.current = now;
        if (
          previous !== null &&
          draft !== null &&
          now.time - previous.time < DOUBLE_CLICK_MS &&
          Math.hypot(now.x - previous.x, now.y - previous.y) < DOUBLE_CLICK_SLOP
        ) {
          lastPress.current = null;
          void store.finish();
          return;
        }
        store.addPoint(sessionId, geometry.pageNumber, toPdf(event));
      }}
      onPointerMove={(event) => setHover(draft === null ? null : toPdf(event))}
      onPointerLeave={() => setHover(null)}
    >
      {cssPoints.length > 0 && (
        <svg className={styles.drawing} aria-hidden="true">
          {closed ? (
            <polygon
              className={styles.shape}
              points={cssPoints.map((point) => `${String(point.x)},${String(point.y)}`).join(' ')}
            />
          ) : (
            <polyline
              className={styles.shape}
              points={cssPoints.map((point) => `${String(point.x)},${String(point.y)}`).join(' ')}
            />
          )}
          {cssPoints.slice(0, draft?.points.length ?? 0).map((point, index) => (
            <circle key={index} className={styles.vertex} cx={point.x} cy={point.y} r={3} />
          ))}
        </svg>
      )}
      {label !== null && anchor !== undefined && (
        <span className={styles.readout} style={{ left: anchor.x + 12, top: anchor.y + 12 }}>
          {label}
        </span>
      )}
    </div>
  );
}

/** Keeps a segment level, upright or at 45°, which is what Shift means when drawing. */
function constrain(from: AnnotationPoint, to: AnnotationPoint): AnnotationPoint {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  return { x: from.x + Math.cos(angle) * length, y: from.y + Math.sin(angle) * length };
}
