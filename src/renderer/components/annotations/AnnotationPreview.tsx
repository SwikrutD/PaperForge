import type { ReactElement } from 'react';
import type { PdfPageGeometry } from '@pdf/render/types';
import type { AnnotationGeometry, AnnotationPoint } from '@shared/schemas/annotation';
import { boundsOf } from '@pdf/mutate/annotations/geometry';
import { pdfRectToCss } from '../viewer/pageGeometry';
import styles from './AnnotationLayer.module.css';

interface AnnotationPreviewProps {
  geometry: AnnotationGeometry;
  pageGeometry: PdfPageGeometry;
  scale: number;
  rotation: number;
}

/**
 * The outline of something that is being drawn or moved.
 *
 * This is deliberately a sketch rather than a rendering: the finished
 * annotation is drawn from the file by the PDF engine, and trying to match it
 * here would mean two drawing implementations that could disagree.
 */
export function AnnotationPreview({
  geometry,
  pageGeometry,
  scale,
  rotation,
}: AnnotationPreviewProps): ReactElement | null {
  const bounds = boundsOf(geometry, 1);
  const box = pdfRectToCss(bounds, pageGeometry, scale, rotation);
  if (box === null) return null;

  const toLocal = (point: AnnotationPoint): { x: number; y: number } => {
    const placed = pdfRectToCss(
      { x: point.x, y: point.y, width: 0.01, height: 0.01 },
      pageGeometry,
      scale,
      rotation,
    );
    return { x: (placed?.left ?? 0) - box.left, y: (placed?.top ?? 0) - box.top };
  };

  return (
    <svg
      className={styles.preview}
      style={{
        left: `${box.left}px`,
        top: `${box.top}px`,
        width: `${Math.max(1, box.width)}px`,
        height: `${Math.max(1, box.height)}px`,
      }}
      viewBox={`0 0 ${Math.max(1, box.width)} ${Math.max(1, box.height)}`}
      data-annotation-preview
      aria-hidden="true"
    >
      {shapeOf(geometry, toLocal, box)}
    </svg>
  );
}

function shapeOf(
  geometry: AnnotationGeometry,
  toLocal: (point: AnnotationPoint) => { x: number; y: number },
  box: { width: number; height: number },
): ReactElement {
  const polyline = (points: readonly AnnotationPoint[], close: boolean): ReactElement => (
    <polyline
      className={styles.previewStroke}
      points={points
        .map(toLocal)
        .map((point) => `${point.x},${point.y}`)
        .join(' ')}
      {...(close ? { fill: 'none' } : { fill: 'none' })}
    />
  );

  switch (geometry.kind) {
    case 'circle':
      return (
        <ellipse
          className={styles.previewStroke}
          cx={box.width / 2}
          cy={box.height / 2}
          rx={Math.max(1, box.width / 2 - 1)}
          ry={Math.max(1, box.height / 2 - 1)}
        />
      );
    case 'line':
    case 'arrow': {
      const from = toLocal(geometry.from);
      const to = toLocal(geometry.to);
      return <line className={styles.previewStroke} x1={from.x} y1={from.y} x2={to.x} y2={to.y} />;
    }
    case 'ink':
      return (
        <g>
          {geometry.strokes.map((stroke, index) => (
            <polyline
              key={index}
              className={styles.previewStroke}
              fill="none"
              points={stroke
                .map(toLocal)
                .map((point) => `${point.x},${point.y}`)
                .join(' ')}
            />
          ))}
        </g>
      );
    case 'polygon':
      return polyline([...geometry.vertices, geometry.vertices[0] as AnnotationPoint], true);
    case 'polyline':
      return polyline(geometry.vertices, false);
    case 'callout':
      return (
        <g>
          {polyline(geometry.callout, false)}
          <rect
            className={styles.previewStroke}
            x={1}
            y={1}
            width={Math.max(1, box.width - 2)}
            height={Math.max(1, box.height - 2)}
          />
        </g>
      );
    default:
      return (
        <rect
          className={styles.previewStroke}
          x={1}
          y={1}
          width={Math.max(1, box.width - 2)}
          height={Math.max(1, box.height - 2)}
        />
      );
  }
}
