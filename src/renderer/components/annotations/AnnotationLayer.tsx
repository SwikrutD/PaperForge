import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from 'react';
import type { PdfPageGeometry } from '@pdf/render/types';
import {
  isOwnStamp,
  type Annotation,
  type AnnotationGeometry,
  type AnnotationInput,
  type AnnotationPoint,
} from '@shared/schemas/annotation';
import { boundsOf, translateGeometry } from '@pdf/mutate/annotations/geometry';
import { cssBoxStyle, cssPointToPdf, pdfRectToCss } from '../viewer/pageGeometry';
import {
  geometryFromDrag,
  geometryFromPath,
  isDragTool,
  isPathTool,
  DRAG_THRESHOLD,
} from './annotationDrawing';
import { AnnotationPreview } from './AnnotationPreview';
import { PendingAnnotationMark } from './PendingAnnotationMark';
import { StampTransformFrame } from './StampTransformFrame';
import { pointAt } from '../edit/imageGeometry';
import type { AnnotationTool, PendingAnnotation } from '../../stores/annotationStore';
import { awaitingPaint, usePaintedRevision } from '../viewer/paintedRevision';
import styles from './AnnotationLayer.module.css';

interface AnnotationLayerProps {
  geometry: PdfPageGeometry;
  scale: number;
  rotation: number;
  annotations: readonly Annotation[];
  tool: AnnotationTool;
  selectedId: string | null;
  /** Size an image stamp is placed at, when one has been chosen. */
  stampSize?: { width: number; height: number } | undefined;
  onSelect: (id: string | null) => void;
  onCreate: (geometry: AnnotationGeometry, pageNumber: number) => void;
  onMove: (annotation: Annotation, geometry: AnnotationGeometry) => void;
  onErase: (annotation: Annotation) => void;
  /** Resizes or turns a stamp PaperForge made; without it, stamps have no handles. */
  onTransform?: (
    annotation: Annotation,
    rect: { x: number; y: number; width: number; height: number },
    rotation: number,
  ) => void;
  onDuplicate?: (annotation: Annotation) => void;
  /** A draft being typed into, drawn while it has no annotation yet. */
  draft: AnnotationInput | null;
  /** Marks of this page still being written into the document. */
  pending?: readonly PendingAnnotation[];
  /** Called with the pending marks the page's picture now shows itself. */
  onSettle?: (ids: string[]) => void;
}

const NO_PENDING: readonly PendingAnnotation[] = Object.freeze([]);

interface Drag {
  kind: 'draw' | 'move';
  from: AnnotationPoint;
  current: AnnotationPoint;
  /** Points collected for a path tool. */
  points: AnnotationPoint[];
  annotation?: Annotation;
}

/**
 * The layer that turns pointer movement into annotations, and lets the reader
 * pick one up again.
 *
 * What is drawn on the page comes from the document itself — PDF.js paints the
 * appearance streams onto the canvas — so this layer draws only what does not
 * exist yet: the shape being dragged out, the selection outline, and the
 * hit areas that make an annotation clickable — and, until the page has been
 * drawn again, the marks that have just been made, so nothing disappears
 * between the gesture and the new picture.
 */
export function AnnotationLayer({
  geometry,
  scale,
  rotation,
  annotations,
  tool,
  selectedId,
  stampSize,
  onSelect,
  onCreate,
  onMove,
  onErase,
  onTransform,
  onDuplicate,
  draft,
  pending = NO_PENDING,
  onSettle,
}: AnnotationLayerProps): ReactElement | null {
  const layerRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const painted = usePaintedRevision();

  // Once the picture includes a mark, the picture is what shows it.
  useEffect(() => {
    const settled = pending
      .filter((entry) => !awaitingPaint(entry.madeIn, painted))
      .map((entry) => entry.id);
    if (settled.length > 0) onSettle?.(settled);
  }, [pending, painted, onSettle]);

  const toPdf = (event: ReactPointerEvent): AnnotationPoint => {
    const bounds = layerRef.current?.getBoundingClientRect();
    const x = event.clientX - (bounds?.left ?? 0);
    const y = event.clientY - (bounds?.top ?? 0);
    return cssPointToPdf({ x, y }, geometry, scale, rotation);
  };

  const drawing = isDragTool(tool) || isPathTool(tool);
  const erasing = tool === 'eraser';

  const startDraw = (event: ReactPointerEvent): void => {
    if (!drawing || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = toPdf(event);
    setDrag({ kind: 'draw', from: point, current: point, points: [point] });
  };

  const continueDraw = (event: ReactPointerEvent): void => {
    if (drag === null) return;
    const point = toPdf(event);

    setDrag((current) => {
      if (current === null) return null;
      if (current.kind === 'move' && current.annotation !== undefined) {
        return { ...current, current: point };
      }
      // A path tool keeps every point; a drag tool only needs where it is now.
      const points = isPathTool(tool) ? [...current.points, point] : current.points;
      return { ...current, current: point, points };
    });
  };

  const finishDraw = (event: ReactPointerEvent): void => {
    if (drag === null) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    const point = toPdf(event);

    if (drag.kind === 'move' && drag.annotation !== undefined) {
      const dx = point.x - drag.from.x;
      const dy = point.y - drag.from.y;
      if (Math.hypot(dx, dy) >= DRAG_THRESHOLD) {
        onMove(drag.annotation, translateGeometry(drag.annotation.geometry, dx, dy));
      }
      setDrag(null);
      return;
    }

    const built = isPathTool(tool)
      ? geometryFromPath(tool, [...drag.points, point])
      : isDragTool(tool)
        ? geometryFromDrag(tool, drag.from, point, stampSize)
        : null;

    if (built !== null) onCreate(built, geometry.pageNumber);
    setDrag(null);
  };

  const startMove = (event: ReactPointerEvent, annotation: Annotation): void => {
    if (tool !== 'select' || event.button !== 0) return;
    onSelect(annotation.id);
    if (!annotation.editable) return;

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = toPdf(event);
    setDrag({ kind: 'move', from: point, current: point, points: [], annotation });
  };

  const previewGeometry =
    drag?.kind === 'draw'
      ? isPathTool(tool)
        ? geometryFromPath(tool, drag.points)
        : isDragTool(tool)
          ? geometryFromDrag(tool, drag.from, drag.current, stampSize)
          : null
      : null;

  const movingGeometry =
    drag?.kind === 'move' && drag.annotation !== undefined
      ? translateGeometry(
          drag.annotation.geometry,
          drag.current.x - drag.from.x,
          drag.current.y - drag.from.y,
        )
      : null;

  return (
    <>
      {pending
        .filter((entry) => awaitingPaint(entry.madeIn, painted))
        .map((entry) => (
          <PendingAnnotationMark
            key={entry.id}
            input={entry.input}
            pageGeometry={geometry}
            scale={scale}
            rotation={rotation}
          />
        ))}
      <div
        className={styles.layer}
        ref={layerRef}
        data-annotation-layer={geometry.pageNumber}
        // Drawing needs the pointer on the layer; erasing and selecting need it
        // on the annotations themselves.
        data-mode={drawing ? 'draw' : erasing ? 'erase' : 'select'}
        onPointerDown={startDraw}
        onPointerMove={continueDraw}
        onPointerUp={finishDraw}
        onPointerCancel={() => setDrag(null)}
      >
        {annotations.map((annotation) => {
          const box = pdfRectToCss(extentOf(annotation), geometry, scale, rotation);
          if (box === null) return null;
          const selected = annotation.id === selectedId;

          return (
            <button
              key={annotation.id}
              type="button"
              className={`${styles.hit} ${selected ? styles.selected : ''}`}
              style={cssBoxStyle(box)}
              data-annotation={annotation.id}
              aria-label={describe(annotation)}
              aria-pressed={selected}
              tabIndex={tool === 'select' ? 0 : -1}
              onPointerDown={(event) => {
                if (erasing) {
                  event.stopPropagation();
                  onErase(annotation);
                  return;
                }
                startMove(event, annotation);
              }}
            />
          );
        })}

        {tool === 'select' &&
          onTransform !== undefined &&
          onDuplicate !== undefined &&
          drag === null &&
          annotations
            .filter((annotation) => annotation.id === selectedId && isOwnStamp(annotation))
            .map((annotation) => (
              <StampTransformFrame
                key={`frame-${annotation.id}`}
                annotation={annotation}
                geometry={geometry}
                scale={scale}
                rotation={rotation}
                onTransform={onTransform}
                onDuplicate={onDuplicate}
              />
            ))}

        {previewGeometry !== null && (
          <AnnotationPreview
            geometry={previewGeometry}
            pageGeometry={geometry}
            scale={scale}
            rotation={rotation}
          />
        )}

        {movingGeometry !== null && (
          <AnnotationPreview
            geometry={movingGeometry}
            pageGeometry={geometry}
            scale={scale}
            rotation={rotation}
          />
        )}

        {draft !== null && draft.pageNumber === geometry.pageNumber && (
          <AnnotationPreview
            geometry={draft.geometry}
            pageGeometry={geometry}
            scale={scale}
            rotation={rotation}
          />
        )}
      </div>
    </>
  );
}

/**
 * The area an annotation covers on the page: its rectangle, or for a turned
 * stamp the upright box the turned stamp needs.
 */
function extentOf(annotation: Annotation): ReturnType<typeof boundsOf> {
  const bounds = boundsOf(annotation.geometry, annotation.style.borderWidth);
  const turn = annotation.rotation ?? 0;
  if (turn === 0 || !('rect' in annotation.geometry)) return bounds;

  const placement = { ...bounds, rotation: turn, flipX: false, flipY: false };
  const corners = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 1 },
  ].map((corner) => pointAt(placement, corner));
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** What a screen reader says about an annotation's hit area. */
function describe(annotation: Annotation): string {
  const text = annotation.contents.trim();
  const author = annotation.author === '' ? '' : ` by ${annotation.author}`;
  return text === ''
    ? `${annotation.geometry.kind}${author}`
    : `${annotation.geometry.kind}${author}: ${text.slice(0, 80)}`;
}
