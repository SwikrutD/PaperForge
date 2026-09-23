import {
  PDFArray,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
  type PDFDocument,
  type PDFPage,
} from 'pdf-lib';
import {
  DEFAULT_ANNOTATION_STYLE,
  type Annotation,
  type AnnotationColor,
  type AnnotationGeometry,
  type AnnotationKind,
  type AnnotationPoint,
  type AnnotationStyle,
} from '@shared/schemas/annotation';
import { boundsOf } from './geometry';
import { fromPdfDate } from './pdfDate';

/**
 * Reading annotations back out of a document.
 *
 * PaperForge reads what is in the file, not a private list of what it wrote:
 * an annotation somebody else made shows up in the comments panel too. What it
 * cannot redraw faithfully it still lists, marked as not editable, rather than
 * hiding or silently replacing it.
 */

export interface AnnotationRecord {
  annotation: Annotation;
  /** The dictionary itself, for changes that patch it in place. */
  dict: PDFDict;
  /** Indirect reference, which is how a deletion finds it again. */
  ref: string;
  pageIndex: number;
}

function stringOf(dict: PDFDict, key: string): string | undefined {
  const value = dict.get(PDFName.of(key));
  if (value instanceof PDFString) return value.asString();
  if (value instanceof PDFHexString) return value.decodeText();
  return undefined;
}

function numberOf(dict: PDFDict, key: string): number | undefined {
  const value = dict.get(PDFName.of(key));
  return value instanceof PDFNumber ? value.asNumber() : undefined;
}

function nameOf(dict: PDFDict, key: string): string | undefined {
  const value = dict.get(PDFName.of(key));
  return value instanceof PDFName ? value.asString().replace(/^\//, '') : undefined;
}

function numberArray(value: unknown): number[] {
  if (!(value instanceof PDFArray)) return [];
  const numbers: number[] = [];
  for (let index = 0; index < value.size(); index += 1) {
    const entry = value.get(index);
    if (entry instanceof PDFNumber) numbers.push(entry.asNumber());
  }
  return numbers;
}

function colorOf(dict: PDFDict, key: string): AnnotationColor | null {
  const components = numberArray(dict.get(PDFName.of(key)));
  if (components.length >= 3) {
    return { r: clamp(components[0]), g: clamp(components[1]), b: clamp(components[2]) };
  }
  if (components.length === 1) {
    const grey = clamp(components[0]);
    return { r: grey, g: grey, b: grey };
  }
  return null;
}

function clamp(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function pointsFrom(values: readonly number[]): AnnotationPoint[] {
  const points: AnnotationPoint[] = [];
  for (let index = 0; index + 1 < values.length; index += 2) {
    points.push({ x: values[index] as number, y: values[index + 1] as number });
  }
  return points;
}

/** Which PaperForge kind a subtype and its variant entries amount to. */
function kindOf(dict: PDFDict): AnnotationKind | null {
  const subtype = nameOf(dict, 'Subtype');
  switch (subtype) {
    case 'Highlight':
      return 'highlight';
    case 'Underline':
      return 'underline';
    case 'StrikeOut':
      return 'strikeOut';
    case 'Squiggly':
      return 'squiggly';
    case 'Text':
      return 'note';
    case 'FreeText':
      return dict.get(PDFName.of('CL')) === undefined ? 'freeText' : 'callout';
    case 'Square':
      return 'square';
    case 'Circle':
      return 'circle';
    case 'Line':
      return hasArrowEnding(dict) ? 'arrow' : 'line';
    case 'Polygon':
      return 'polygon';
    case 'PolyLine':
      return 'polyline';
    case 'Ink':
      return 'ink';
    case 'Stamp':
      return 'stamp';
    default:
      return null;
  }
}

function hasArrowEnding(dict: PDFDict): boolean {
  const endings = dict.get(PDFName.of('LE'));
  if (endings instanceof PDFName) return endings.asString().includes('Arrow');
  if (endings instanceof PDFArray) {
    for (let index = 0; index < endings.size(); index += 1) {
      const entry = endings.get(index);
      if (entry instanceof PDFName && entry.asString().includes('Arrow')) return true;
    }
  }
  return false;
}

/** The shape inside an annotation rectangle, once `/RD` is taken off it. */
function insetByDifferences(
  rect: { x: number; y: number; width: number; height: number },
  differences: readonly number[],
): { x: number; y: number; width: number; height: number } {
  if (differences.length < 4) return rect;
  const [left = 0, bottom = 0, right = 0, top = 0] = differences;
  const width = rect.width - left - right;
  const height = rect.height - bottom - top;
  if (width <= 0 || height <= 0) return rect;
  return { x: rect.x + left, y: rect.y + bottom, width, height };
}

/** Rebuilds the geometry from the entries the annotation's subtype uses. */
function geometryOf(dict: PDFDict, kind: AnnotationKind): AnnotationGeometry | null {
  const rectangle = numberArray(dict.get(PDFName.of('Rect')));
  const outer =
    rectangle.length >= 4
      ? {
          x: Math.min(rectangle[0] as number, rectangle[2] as number),
          y: Math.min(rectangle[1] as number, rectangle[3] as number),
          width: Math.abs((rectangle[2] as number) - (rectangle[0] as number)),
          height: Math.abs((rectangle[3] as number) - (rectangle[1] as number)),
        }
      : null;
  const rect =
    outer === null ? null : insetByDifferences(outer, numberArray(dict.get(PDFName.of('RD'))));

  switch (kind) {
    case 'highlight':
    case 'underline':
    case 'strikeOut':
    case 'squiggly': {
      const flat = numberArray(dict.get(PDFName.of('QuadPoints')));
      const quads: number[][] = [];
      for (let index = 0; index + 7 < flat.length; index += 8) {
        quads.push(flat.slice(index, index + 8));
      }
      return quads.length === 0 ? null : { kind, quads };
    }
    case 'note':
      return rect === null ? null : { kind, point: { x: rect.x, y: rect.y + rect.height } };
    case 'freeText':
    case 'square':
    case 'circle':
    case 'stamp':
      return rect === null ? null : { kind, rect };
    case 'callout': {
      const callout = pointsFrom(numberArray(dict.get(PDFName.of('CL'))));
      if (rect === null || callout.length < 2) return null;
      const [first, second, third] = callout;
      if (first === undefined || second === undefined) return null;
      return {
        kind,
        rect,
        callout: third === undefined ? [first, second] : [first, second, third],
      };
    }
    case 'line':
    case 'arrow': {
      const coordinates = numberArray(dict.get(PDFName.of('L')));
      if (coordinates.length < 4) return null;
      return {
        kind,
        from: { x: coordinates[0] as number, y: coordinates[1] as number },
        to: { x: coordinates[2] as number, y: coordinates[3] as number },
      };
    }
    case 'polygon':
    case 'polyline': {
      const vertices = pointsFrom(numberArray(dict.get(PDFName.of('Vertices'))));
      return vertices.length < 2 ? null : { kind, vertices };
    }
    case 'ink': {
      const list = dict.get(PDFName.of('InkList'));
      if (!(list instanceof PDFArray)) return null;
      const strokes: AnnotationPoint[][] = [];
      for (let index = 0; index < list.size(); index += 1) {
        const stroke = pointsFrom(numberArray(list.get(index)));
        if (stroke.length > 0) strokes.push(stroke);
      }
      return strokes.length === 0 ? null : { kind, strokes };
    }
    case 'imageStamp':
      return null;
  }
}

function styleOf(dict: PDFDict): AnnotationStyle {
  const border = dict.get(PDFName.of('BS'));
  const borderDict = border instanceof PDFDict ? border : undefined;
  const width = borderDict === undefined ? undefined : numberOf(borderDict, 'W');
  const dashed = borderDict !== undefined && nameOf(borderDict, 'S') === 'D';

  return {
    color: colorOf(dict, 'C') ?? DEFAULT_ANNOTATION_STYLE.color,
    opacity: Math.min(1, Math.max(0.05, numberOf(dict, 'CA') ?? 1)),
    borderWidth: Math.min(72, Math.max(0, width ?? DEFAULT_ANNOTATION_STYLE.borderWidth)),
    borderStyle: dashed ? 'dashed' : 'solid',
    fillColor: colorOf(dict, 'IC'),
    fontSize: fontSizeFrom(stringOf(dict, 'DA')) ?? DEFAULT_ANNOTATION_STYLE.fontSize,
    textColor: textColorFrom(stringOf(dict, 'DA')) ?? DEFAULT_ANNOTATION_STYLE.textColor,
  };
}

/** Pulls the size out of a `/DA` string such as "0 g /Helv 12 Tf". */
function fontSizeFrom(defaultAppearance: string | undefined): number | null {
  if (defaultAppearance === undefined) return null;
  const match = /\/([^\s]+)\s+([\d.]+)\s+Tf/.exec(defaultAppearance);
  const size = match === null ? Number.NaN : Number.parseFloat(match[2] ?? '');
  return Number.isFinite(size) && size >= 4 && size <= 144 ? size : null;
}

function textColorFrom(defaultAppearance: string | undefined): AnnotationColor | null {
  if (defaultAppearance === undefined) return null;
  const rgb = /([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/.exec(defaultAppearance);
  if (rgb !== null) {
    return {
      r: clamp(Number.parseFloat(rgb[1] ?? '0')),
      g: clamp(Number.parseFloat(rgb[2] ?? '0')),
      b: clamp(Number.parseFloat(rgb[3] ?? '0')),
    };
  }
  const grey = /([\d.]+)\s+g\b/.exec(defaultAppearance);
  if (grey !== null) {
    const value = clamp(Number.parseFloat(grey[1] ?? '0'));
    return { r: value, g: value, b: value };
  }
  return null;
}

/** Every annotation in the document, in page order. */
export function readAnnotations(document: PDFDocument): AnnotationRecord[] {
  const records: AnnotationRecord[] = [];

  document.getPages().forEach((page: PDFPage, pageIndex: number) => {
    const annots = page.node.Annots();
    if (annots === undefined) return;

    for (let index = 0; index < annots.size(); index += 1) {
      const entry = annots.get(index);
      const dict = annots.lookup(index);
      if (!(dict instanceof PDFDict)) continue;

      const record = toRecord(dict, pageIndex, entry instanceof PDFRef ? entry.toString() : '');
      if (record !== null) records.push(record);
    }
  });

  return records;
}

function toRecord(dict: PDFDict, pageIndex: number, ref: string): AnnotationRecord | null {
  const kind = kindOf(dict);
  // Links, form fields and popups belong to other parts of the application.
  if (kind === null) return null;

  const geometry = geometryOf(dict, kind);
  const style = styleOf(dict);
  const id = stringOf(dict, 'NM') ?? ref;
  if (id === '') return null;

  const rectangle = numberArray(dict.get(PDFName.of('Rect')));
  const fallback: AnnotationGeometry | null =
    rectangle.length >= 4
      ? {
          kind: 'square',
          rect: {
            x: Math.min(rectangle[0] as number, rectangle[2] as number),
            y: Math.min(rectangle[1] as number, rectangle[3] as number),
            width: Math.abs((rectangle[2] as number) - (rectangle[0] as number)),
            height: Math.abs((rectangle[3] as number) - (rectangle[1] as number)),
          },
        }
      : null;

  const resolvedGeometry = geometry ?? fallback;
  if (resolvedGeometry === null) return null;

  const annotation: Annotation = {
    id,
    pageNumber: pageIndex + 1,
    geometry: resolvedGeometry,
    style,
    contents: stringOf(dict, 'Contents') ?? '',
    author: stringOf(dict, 'T') ?? '',
    subject: stringOf(dict, 'Subj') ?? '',
    createdAt: fromPdfDate(stringOf(dict, 'CreationDate')),
    modifiedAt: fromPdfDate(stringOf(dict, 'M')),
    resolved: stringOf(dict, 'PFStatus') === 'resolved',
    // An annotation whose geometry PaperForge could not read is listed and can
    // be deleted, but not moved or restyled: it would have to be redrawn, and
    // PaperForge does not know what it looks like.
    editable: geometry !== null,
    ...(stampLabelOf(dict) === undefined ? {} : { stampLabel: stampLabelOf(dict) }),
  };

  return { annotation, dict, ref, pageIndex };
}

/** The label of a stamp PaperForge wrote, from its `/Name`. */
function stampLabelOf(dict: PDFDict): string | undefined {
  const name = nameOf(dict, 'Name');
  if (name === undefined || !name.startsWith('PF')) return undefined;
  const label = name.slice(2);
  return label === '' ? undefined : label;
}

/** The rectangle an annotation occupies, for the overlay's hit testing. */
export function annotationBounds(annotation: Annotation): ReturnType<typeof boundsOf> {
  return boundsOf(annotation.geometry, annotation.style.borderWidth);
}
