import type { ReactElement } from 'react';
import type { PdfPageGeometry } from '@pdf/render/types';
import type {
  AnnotationColor,
  AnnotationInput,
  AnnotationPoint,
  AnnotationQuad,
  AnnotationRect,
} from '@shared/schemas/annotation';
import { pdfRectToCss } from '../viewer/pageGeometry';
import styles from './AnnotationLayer.module.css';

interface PendingAnnotationMarkProps {
  input: AnnotationInput;
  pageGeometry: PdfPageGeometry;
  scale: number;
  rotation: number;
}

/**
 * A mark that has been made but is not yet in the page's picture, drawn in
 * its own colours so the change is visible the moment the gesture ends.
 *
 * It only has to hold the place for as long as the document takes to be
 * rewritten and drawn — a fraction of a second — after which the picture
 * drawn from the file replaces it. It is close to the finished mark, not a
 * second rendering of it: an image stamp, whose picture lives in the main
 * process, is shown as its outline.
 */
export function PendingAnnotationMark({
  input,
  pageGeometry,
  scale,
  rotation,
}: PendingAnnotationMarkProps): ReactElement {
  const { geometry, style } = input;
  const toCss = (point: AnnotationPoint): { x: number; y: number } => {
    const box = pdfRectToCss(
      { x: point.x, y: point.y, width: 0.01, height: 0.01 },
      pageGeometry,
      scale,
      rotation,
    );
    return { x: box?.left ?? 0, y: box?.top ?? 0 };
  };
  const path = (points: readonly AnnotationPoint[]): string =>
    points
      .map(toCss)
      .map((point) => `${point.x},${point.y}`)
      .join(' ');

  const stroke = cssColor(style.color);
  const strokeWidth = Math.max(1, style.borderWidth * scale);
  const dash = style.borderStyle === 'dashed' ? `${strokeWidth * 3} ${strokeWidth * 2}` : undefined;
  const lineProps = {
    stroke,
    strokeWidth,
    strokeDasharray: dash,
    fill: 'none',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  const fill = style.fillColor === null ? 'none' : cssColor(style.fillColor);

  const rectOf = (
    rect: AnnotationRect,
  ): { x: number; y: number; width: number; height: number } => {
    const a = toCss({ x: rect.x, y: rect.y });
    const b = toCss({ x: rect.x + rect.width, y: rect.y + rect.height });
    return {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: Math.abs(b.x - a.x),
      height: Math.abs(b.y - a.y),
    };
  };

  const text = (box: { x: number; y: number; width: number }, contents: string): ReactElement => {
    const size = style.fontSize * scale;
    return (
      <text
        fill={cssColor(style.textColor)}
        fontSize={size}
        fontFamily="Helvetica, Arial, sans-serif"
      >
        {contents.split('\n').map((line, index) => (
          <tspan key={index} x={box.x + 2 * scale} y={box.y + size * (index + 1)}>
            {line}
          </tspan>
        ))}
      </text>
    );
  };

  let shape: ReactElement;
  switch (geometry.kind) {
    case 'highlight':
      shape = (
        <g>
          {geometry.quads.map((quad, index) => (
            <polygon key={index} points={path(quadOutline(quad))} fill={stroke} />
          ))}
        </g>
      );
      break;
    case 'underline':
    case 'strikeOut':
    case 'squiggly':
      shape = (
        <g>
          {geometry.quads.map((quad, index) => {
            const [upperLeft, upperRight, lowerRight, lowerLeft] = quadOutline(quad).map(toCss) as [
              { x: number; y: number },
              { x: number; y: number },
              { x: number; y: number },
              { x: number; y: number },
            ];
            const height = Math.hypot(upperLeft.x - lowerLeft.x, upperLeft.y - lowerLeft.y);
            const width = Math.max(1, height * 0.07);
            if (geometry.kind === 'squiggly') {
              return (
                <polyline
                  key={index}
                  {...lineProps}
                  strokeWidth={width}
                  points={squiggle(lowerLeft, lowerRight, Math.max(2, height * 0.12))}
                />
              );
            }
            const from =
              geometry.kind === 'underline'
                ? lowerLeft
                : { x: (upperLeft.x + lowerLeft.x) / 2, y: (upperLeft.y + lowerLeft.y) / 2 };
            const to =
              geometry.kind === 'underline'
                ? lowerRight
                : { x: (upperRight.x + lowerRight.x) / 2, y: (upperRight.y + lowerRight.y) / 2 };
            return (
              <line
                key={index}
                {...lineProps}
                strokeWidth={width}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
              />
            );
          })}
        </g>
      );
      break;
    case 'note': {
      const corner = toCss(geometry.point);
      const size = 20 * scale;
      shape = <rect x={corner.x} y={corner.y} width={size} height={size} rx={2} fill={stroke} />;
      break;
    }
    case 'square': {
      const box = rectOf(geometry.rect);
      shape = <rect {...box} {...lineProps} fill={fill} />;
      break;
    }
    case 'circle': {
      const box = rectOf(geometry.rect);
      shape = (
        <ellipse
          cx={box.x + box.width / 2}
          cy={box.y + box.height / 2}
          rx={box.width / 2}
          ry={box.height / 2}
          {...lineProps}
          fill={fill}
        />
      );
      break;
    }
    case 'freeText': {
      const box = rectOf(geometry.rect);
      shape = (
        <g>
          <rect {...box} fill={fill} />
          {text(box, input.contents)}
        </g>
      );
      break;
    }
    case 'callout': {
      const box = rectOf(geometry.rect);
      shape = (
        <g>
          <polyline {...lineProps} points={path(geometry.callout)} />
          <rect {...box} {...lineProps} fill={fill} />
          {text(box, input.contents)}
        </g>
      );
      break;
    }
    case 'stamp':
    case 'imageStamp': {
      const box = rectOf(geometry.rect);
      const label = geometry.kind === 'stamp' ? (input.stampLabel ?? '') : '';
      // Turned anticlockwise on the page is anticlockwise on screen, which
      // SVG, counting y downwards, writes as a negative angle.
      const turn = input.rotation ?? 0;
      shape = (
        <g
          {...(turn === 0
            ? {}
            : {
                transform: `rotate(${String(-turn)} ${String(box.x + box.width / 2)} ${String(
                  box.y + box.height / 2,
                )})`,
              })}
        >
          <rect
            {...box}
            {...lineProps}
            {...(geometry.kind === 'imageStamp'
              ? { stroke: 'currentColor', strokeDasharray: '4 3', strokeWidth: 1 }
              : {})}
            rx={4}
          />
          {label !== '' && (
            <text
              x={box.x + box.width / 2}
              y={box.y + box.height / 2}
              fill={stroke}
              fontSize={Math.max(8, box.height * 0.45)}
              fontWeight="bold"
              textAnchor="middle"
              dominantBaseline="central"
              fontFamily="Helvetica, Arial, sans-serif"
            >
              {label.toUpperCase()}
            </text>
          )}
        </g>
      );
      break;
    }
    case 'line':
    case 'arrow': {
      const from = toCss(geometry.from);
      const to = toCss(geometry.to);
      shape = (
        <g>
          <line {...lineProps} x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
          {geometry.kind === 'arrow' && (
            <polyline {...lineProps} points={arrowHead(from, to, strokeWidth)} />
          )}
        </g>
      );
      break;
    }
    case 'polygon':
      shape = <polygon {...lineProps} fill={fill} points={path(geometry.vertices)} />;
      break;
    case 'polyline':
      shape = <polyline {...lineProps} points={path(geometry.vertices)} />;
      break;
    case 'ink':
      shape = (
        <g>
          {geometry.strokes.map((points, index) => (
            <polyline key={index} {...lineProps} points={path(points)} />
          ))}
        </g>
      );
      break;
  }

  return (
    <svg
      className={styles.pending}
      opacity={style.opacity}
      // As the file draws it: multiplied, so the words underneath stay legible.
      style={geometry.kind === 'highlight' ? { mixBlendMode: 'multiply' } : undefined}
      data-pending-annotation={geometry.kind}
      aria-hidden="true"
    >
      {shape}
    </svg>
  );
}

function cssColor(color: AnnotationColor): string {
  const channel = (value: number): number => Math.round(value * 255);
  return `rgb(${channel(color.r)}, ${channel(color.g)}, ${channel(color.b)})`;
}

/** A quad's corners in drawing order: upper-left, upper-right, lower-right, lower-left. */
function quadOutline(quad: AnnotationQuad): AnnotationPoint[] {
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0, x3 = 0, y3 = 0, x4 = 0, y4 = 0] = quad;
  return [
    { x: x1, y: y1 },
    { x: x2, y: y2 },
    { x: x4, y: y4 },
    { x: x3, y: y3 },
  ];
}

/** A zigzag from one point to another, for a squiggly underline. */
function squiggle(
  from: { x: number; y: number },
  to: { x: number; y: number },
  amplitude: number,
): string {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const steps = Math.max(2, Math.round(length / (amplitude * 2)));
  const normal = { x: -(to.y - from.y) / (length || 1), y: (to.x - from.x) / (length || 1) };
  const points: string[] = [];
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const offset = step % 2 === 0 ? 0 : -amplitude;
    points.push(
      `${from.x + (to.x - from.x) * t + normal.x * offset},${from.y + (to.y - from.y) * t + normal.y * offset}`,
    );
  }
  return points.join(' ');
}

/** The two short strokes of an arrow's head at `to`. */
function arrowHead(
  from: { x: number; y: number },
  to: { x: number; y: number },
  width: number,
): string {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const size = Math.max(8, width * 4);
  const wing = (turn: number): string =>
    `${to.x - size * Math.cos(angle + turn)},${to.y - size * Math.sin(angle + turn)}`;
  return `${wing(Math.PI / 7)} ${to.x},${to.y} ${wing(-Math.PI / 7)}`;
}
