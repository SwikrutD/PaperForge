import type {
  AnnotationColor,
  AnnotationGeometry,
  AnnotationPoint,
  AnnotationRect,
  AnnotationStyle,
} from '@shared/schemas/annotation';
import { quadCorners, NOTE_SIZE } from './geometry';

/**
 * The content streams PaperForge draws annotations with.
 *
 * Every annotation gets an appearance stream, so what a reader sees is what
 * the file says rather than whatever each viewer decides to synthesise. The
 * operators are written in page coordinates and the form's BBox is the
 * annotation rectangle, which makes the mapping from form space to page space
 * the identity.
 */

/** How much of a marked line an underline sits above its bottom. */
const UNDERLINE_OFFSET = 0.08;
const STRIKE_OFFSET = 0.42;
const SQUIGGLE_HEIGHT = 2.2;
const SQUIGGLE_STEP = 3.4;
/** Arrowhead length as a multiple of the line width. */
const ARROW_HEAD = 6;

export interface AppearanceContext {
  style: AnnotationStyle;
  /** Resource name of the font, when the appearance draws text. */
  fontName: string;
  /** Lines already broken to fit the box. */
  textLines: readonly string[];
  /** Resource name of the image, for an image stamp. */
  imageName?: string | undefined;
  /** Width and height the image should be drawn at. */
  imageSize?: { width: number; height: number } | undefined;
  /** A built-in stamp's label, already measured and placed. */
  stampText?: { text: string; size: number; x: number; y: number } | undefined;
  /** A measurement's value, placed beside the shape it measures. */
  caption?: { text: string; size: number; x: number; y: number } | undefined;
}

function number(value: number): string {
  // PDF numbers are plain decimals: no exponent form, no trailing noise.
  return Number.isFinite(value) ? Number(value.toFixed(4)).toString() : '0';
}

function point(value: AnnotationPoint): string {
  return `${number(value.x)} ${number(value.y)}`;
}

function strokeColor(color: AnnotationColor): string {
  return `${number(color.r)} ${number(color.g)} ${number(color.b)} RG`;
}

function fillColor(color: AnnotationColor): string {
  return `${number(color.r)} ${number(color.g)} ${number(color.b)} rg`;
}

function dashPattern(style: AnnotationStyle): string {
  const width = Math.max(1, style.borderWidth);
  return style.borderStyle === 'dashed'
    ? `[${number(width * 3)} ${number(width * 2)}] 0 d`
    : '[] 0 d';
}

function strokeSetup(style: AnnotationStyle): string[] {
  return [
    strokeColor(style.color),
    `${number(style.borderWidth)} w`,
    dashPattern(style),
    '1 J 1 j',
  ];
}

/** Escapes a string for a PDF literal inside a content stream. */
export function escapePdfText(value: string): string {
  return value.replace(/([\\()])/g, '\\$1');
}

/** Draws a path through points, optionally closing it. */
function pathThrough(points: readonly AnnotationPoint[], close: boolean): string[] {
  const first = points[0];
  if (first === undefined) return [];
  const lines = [`${point(first)} m`];
  for (const next of points.slice(1)) lines.push(`${point(next)} l`);
  if (close) lines.push('h');
  return lines;
}

/** An ellipse inscribed in a rectangle, as four Bézier curves. */
function ellipsePath(rect: AnnotationRect): string[] {
  const kappa = 0.5523;
  const halfWidth = rect.width / 2;
  const halfHeight = rect.height / 2;
  const centreX = rect.x + halfWidth;
  const centreY = rect.y + halfHeight;
  const ox = halfWidth * kappa;
  const oy = halfHeight * kappa;
  const left = rect.x;
  const right = rect.x + rect.width;
  const bottom = rect.y;
  const top = rect.y + rect.height;

  return [
    `${number(left)} ${number(centreY)} m`,
    `${number(left)} ${number(centreY + oy)} ${number(centreX - ox)} ${number(top)} ${number(centreX)} ${number(top)} c`,
    `${number(centreX + ox)} ${number(top)} ${number(right)} ${number(centreY + oy)} ${number(right)} ${number(centreY)} c`,
    `${number(right)} ${number(centreY - oy)} ${number(centreX + ox)} ${number(bottom)} ${number(centreX)} ${number(bottom)} c`,
    `${number(centreX - ox)} ${number(bottom)} ${number(left)} ${number(centreY - oy)} ${number(left)} ${number(centreY)} c`,
  ];
}

function paintOperator(style: AnnotationStyle, close: boolean): string {
  const stroked = style.borderWidth > 0;
  if (style.fillColor !== null && stroked) return close ? 'b' : 'B';
  if (style.fillColor !== null) return 'f';
  return close ? 's' : 'S';
}

function fillSetup(style: AnnotationStyle): string[] {
  return style.fillColor === null ? [] : [fillColor(style.fillColor)];
}

/** The arrowhead at the end of a line, as a filled triangle. */
function arrowHead(from: AnnotationPoint, to: AnnotationPoint, style: AnnotationStyle): string[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < 0.001) return [];

  const size = Math.max(4, style.borderWidth * ARROW_HEAD);
  const ux = dx / length;
  const uy = dy / length;
  const baseX = to.x - ux * size;
  const baseY = to.y - uy * size;
  const spread = size * 0.4;

  return [
    fillColor(style.color),
    `${point(to)} m`,
    `${number(baseX - uy * spread)} ${number(baseY + ux * spread)} l`,
    `${number(baseX + uy * spread)} ${number(baseY - ux * spread)} l`,
    'h',
    'f',
  ];
}

/** The zigzag a squiggly underline draws under a line of text. */
function squiggle(left: number, right: number, baseline: number): string[] {
  const points: AnnotationPoint[] = [];
  let up = true;
  for (let x = left; x < right; x += SQUIGGLE_STEP) {
    points.push({ x, y: baseline + (up ? SQUIGGLE_HEIGHT : 0) });
    up = !up;
  }
  points.push({ x: right, y: baseline + (up ? SQUIGGLE_HEIGHT : 0) });
  return pathThrough(points, false);
}

/** Text drawing operators for a box of already-wrapped lines. */
function textBlock(
  lines: readonly string[],
  rect: AnnotationRect,
  style: AnnotationStyle,
  fontName: string,
  inset: number,
): string[] {
  if (lines.length === 0) return [];
  const leading = style.fontSize * 1.18;
  const operators = [
    'BT',
    `/${fontName} ${number(style.fontSize)} Tf`,
    `${number(leading)} TL`,
    fillColor(style.textColor),
    `1 0 0 1 ${number(rect.x + inset)} ${number(rect.y + rect.height - inset - style.fontSize)} Tm`,
  ];

  lines.forEach((line, index) => {
    if (index > 0) operators.push('T*');
    operators.push(`(${escapePdfText(line)}) Tj`);
  });
  operators.push('ET');
  return operators;
}

/** A sticky note icon: a rounded speech bubble with a fold. */
function noteIcon(origin: AnnotationPoint, style: AnnotationStyle): string[] {
  const size = NOTE_SIZE;
  const left = origin.x;
  const bottom = origin.y - size;
  const right = left + size;
  const top = origin.y;
  const tail = left + size * 0.3;

  return [
    fillColor(style.color),
    `${number(0.5)} w`,
    strokeColor({ r: 0.15, g: 0.15, b: 0.15 }),
    `${number(left)} ${number(bottom + size * 0.28)} m`,
    `${number(left)} ${number(top)} l`,
    `${number(right)} ${number(top)} l`,
    `${number(right)} ${number(bottom + size * 0.28)} l`,
    `${number(tail + size * 0.18)} ${number(bottom + size * 0.28)} l`,
    `${number(tail)} ${number(bottom)} l`,
    `${number(tail)} ${number(bottom + size * 0.28)} l`,
    'h',
    'B',
    // Three lines standing for the note's text.
    strokeColor({ r: 0.15, g: 0.15, b: 0.15 }),
    `${number(0.7)} w`,
    ...[0.45, 0.6, 0.75].flatMap((fraction) => [
      `${number(left + size * 0.18)} ${number(bottom + size * fraction)} m`,
      `${number(right - size * 0.18)} ${number(bottom + size * fraction)} l`,
    ]),
    'S',
  ];
}

/**
 * Builds the appearance stream for one annotation.
 *
 * Returns the operators as text; the caller wraps them in a form XObject whose
 * BBox is the annotation rectangle.
 */
export function buildAppearance(geometry: AnnotationGeometry, context: AppearanceContext): string {
  const { style } = context;
  const operators: string[] = ['q'];

  switch (geometry.kind) {
    case 'highlight': {
      operators.push('/GSH gs', fillColor(style.color));
      for (const quad of geometry.quads) {
        const { upperLeft, upperRight, lowerLeft, lowerRight } = quadCorners(quad);
        operators.push(...pathThrough([upperLeft, upperRight, lowerRight, lowerLeft], true), 'f');
      }
      break;
    }

    case 'underline':
    case 'strikeOut': {
      const offset = geometry.kind === 'underline' ? UNDERLINE_OFFSET : STRIKE_OFFSET;
      operators.push(strokeColor(style.color));
      for (const quad of geometry.quads) {
        const { upperLeft, lowerLeft, lowerRight } = quadCorners(quad);
        const height = Math.abs(upperLeft.y - lowerLeft.y);
        const y = lowerLeft.y + height * offset;
        operators.push(
          `${number(Math.max(0.6, height * 0.06))} w`,
          `${number(lowerLeft.x)} ${number(y)} m`,
          `${number(lowerRight.x)} ${number(y)} l`,
          'S',
        );
      }
      break;
    }

    case 'squiggly': {
      operators.push(strokeColor(style.color), `${number(0.8)} w`, '1 J 1 j');
      for (const quad of geometry.quads) {
        const { lowerLeft, lowerRight } = quadCorners(quad);
        operators.push(...squiggle(lowerLeft.x, lowerRight.x, lowerLeft.y), 'S');
      }
      break;
    }

    case 'note':
      operators.push(...noteIcon(geometry.point, style));
      break;

    case 'freeText': {
      const rect = geometry.rect;
      if (style.fillColor !== null || style.borderWidth > 0) {
        operators.push(
          ...fillSetup(style),
          ...strokeSetup(style),
          `${number(rect.x)} ${number(rect.y)} ${number(rect.width)} ${number(rect.height)} re`,
          paintOperator(style, true),
        );
      }
      operators.push(
        ...textBlock(context.textLines, rect, style, context.fontName, style.fontSize * 0.35),
      );
      break;
    }

    case 'callout': {
      const rect = geometry.rect;
      operators.push(
        ...strokeSetup(style),
        ...pathThrough(geometry.callout, false),
        'S',
        ...fillSetup(style),
        ...strokeSetup(style),
        `${number(rect.x)} ${number(rect.y)} ${number(rect.width)} ${number(rect.height)} re`,
        paintOperator(style, true),
        ...textBlock(context.textLines, rect, style, context.fontName, style.fontSize * 0.35),
      );
      break;
    }

    case 'square': {
      const rect = geometry.rect;
      operators.push(
        ...fillSetup(style),
        ...strokeSetup(style),
        `${number(rect.x)} ${number(rect.y)} ${number(rect.width)} ${number(rect.height)} re`,
        paintOperator(style, true),
      );
      break;
    }

    case 'circle':
      operators.push(
        ...fillSetup(style),
        ...strokeSetup(style),
        ...ellipsePath(geometry.rect),
        paintOperator(style, true),
      );
      break;

    case 'line':
    case 'arrow':
      operators.push(
        ...strokeSetup(style),
        `${point(geometry.from)} m`,
        `${point(geometry.to)} l`,
        'S',
      );
      if (geometry.kind === 'arrow') {
        operators.push(...arrowHead(geometry.from, geometry.to, style));
      }
      break;

    case 'polygon':
    case 'polyline':
      operators.push(
        ...fillSetup(style),
        ...strokeSetup(style),
        ...pathThrough(geometry.vertices, geometry.kind === 'polygon'),
        geometry.kind === 'polygon' ? paintOperator(style, true) : 'S',
      );
      break;

    case 'ink':
      operators.push(...strokeSetup(style));
      for (const stroke of geometry.strokes) {
        if (stroke.length === 1) {
          // A tap leaves a dot rather than nothing.
          const dot = stroke[0] as AnnotationPoint;
          operators.push(
            fillColor(style.color),
            ...ellipsePath({
              x: dot.x - style.borderWidth / 2,
              y: dot.y - style.borderWidth / 2,
              width: style.borderWidth,
              height: style.borderWidth,
            }),
            'f',
          );
          continue;
        }
        operators.push(...pathThrough(stroke, false), 'S');
      }
      break;

    case 'stamp': {
      const rect = geometry.rect;
      const radius = Math.min(rect.height / 4, 8);
      const label = context.stampText;
      operators.push(
        strokeColor(style.color),
        fillColor({ r: 1, g: 1, b: 1 }),
        `${number(Math.max(1.5, style.borderWidth))} w`,
        ...roundedRect(rect, radius),
        'B',
      );
      if (label !== undefined) {
        operators.push(
          'BT',
          `/${context.fontName} ${number(label.size)} Tf`,
          fillColor(style.color),
          `1 0 0 1 ${number(label.x)} ${number(label.y)} Tm`,
          `(${escapePdfText(label.text)}) Tj`,
          'ET',
        );
      }
      break;
    }

    case 'imageStamp': {
      const rect = geometry.rect;
      const name = context.imageName;
      if (name !== undefined) {
        operators.push(
          `${number(rect.width)} 0 0 ${number(rect.height)} ${number(rect.x)} ${number(rect.y)} cm`,
          `/${name} Do`,
        );
      }
      break;
    }
  }

  const caption = context.caption;
  if (caption !== undefined) {
    operators.push(
      'BT',
      `/${context.fontName} ${number(caption.size)} Tf`,
      fillColor(style.color),
      `1 0 0 1 ${number(caption.x)} ${number(caption.y)} Tm`,
      `(${escapePdfText(caption.text)}) Tj`,
      'ET',
    );
  }

  operators.push('Q');
  return operators.join('\n');
}

/** A rounded rectangle path, for stamps. */
function roundedRect(rect: AnnotationRect, radius: number): string[] {
  const right = rect.x + rect.width;
  const top = rect.y + rect.height;
  const r = Math.max(0, Math.min(radius, rect.width / 2, rect.height / 2));
  const k = r * 0.5523;

  return [
    `${number(rect.x + r)} ${number(rect.y)} m`,
    `${number(right - r)} ${number(rect.y)} l`,
    `${number(right - r + k)} ${number(rect.y)} ${number(right)} ${number(rect.y + r - k)} ${number(right)} ${number(rect.y + r)} c`,
    `${number(right)} ${number(top - r)} l`,
    `${number(right)} ${number(top - r + k)} ${number(right - r + k)} ${number(top)} ${number(right - r)} ${number(top)} c`,
    `${number(rect.x + r)} ${number(top)} l`,
    `${number(rect.x + r - k)} ${number(top)} ${number(rect.x)} ${number(top - r + k)} ${number(rect.x)} ${number(top - r)} c`,
    `${number(rect.x)} ${number(rect.y + r)} l`,
    `${number(rect.x)} ${number(rect.y + r - k)} ${number(rect.x + r - k)} ${number(rect.y)} ${number(rect.x + r)} ${number(rect.y)} c`,
    'h',
  ];
}
