import {
  PDFArray,
  type PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
  StandardFonts,
  type PDFDocument,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib';
import type {
  Annotation,
  AnnotationColor,
  AnnotationGeometry,
  AnnotationInput,
  AnnotationStyle,
} from '@shared/schemas/annotation';
import { buildAppearance } from './appearance';
import {
  applyStampPlacement,
  bboxOf,
  clearTurn,
  isStampKind,
  isTurned,
  normalAppearance,
  placeStamp,
} from './stampTransform';
import { measureDrawing, unionRect, type MeasureDrawing } from './measure';
import { boundsOf } from './geometry';
import { toPdfDate } from './pdfDate';
import { wrapText, toSingleLine } from '../../text/layout';

/**
 * Writing annotations into a document as real PDF annotations.
 *
 * Every annotation is a dictionary in the page's `/Annots` with the entries
 * its subtype calls for, plus an appearance stream so that any reader draws
 * what PaperForge drew. The only PaperForge-specific entry is `/PFStatus`,
 * which carries the resolved flag PDF has no portable place for.
 */

/** Marks an annotation as printable, which is what readers expect. */
const FLAG_PRINT = 4;

/**
 * What `context.obj` accepts. pdf-lib does not export the type, so it is
 * named here rather than casting at every call.
 */
type PdfValue = string | number | boolean | null | undefined | PdfDictLiteral | PdfValue[];
type PdfObjectValue = PDFRef | PDFString | PDFHexString | PDFName;
interface PdfDictLiteral {
  [key: string]: PdfValue | PdfObjectValue | PdfDictLiteral;
}

export interface WriteContext {
  document: PDFDocument;
  /** Helvetica, embedded once and shared by every appearance that draws text. */
  font: PDFFont;
  /** Images staged for stamps, by the token the annotation refers to. */
  images: ReadonlyMap<string, PDFImage>;
}

const SUBTYPES: Record<AnnotationGeometry['kind'], string> = {
  highlight: 'Highlight',
  underline: 'Underline',
  strikeOut: 'StrikeOut',
  squiggly: 'Squiggly',
  note: 'Text',
  freeText: 'FreeText',
  callout: 'FreeText',
  square: 'Square',
  circle: 'Circle',
  line: 'Line',
  arrow: 'Line',
  polygon: 'Polygon',
  polyline: 'PolyLine',
  ink: 'Ink',
  stamp: 'Stamp',
  imageStamp: 'Stamp',
};

function colorArray(color: AnnotationColor): number[] {
  return [color.r, color.g, color.b];
}

/** A text value: Latin-1 where it fits, UTF-16 where the text needs it. */
function textValue(value: string): PDFString | PDFHexString {
  // eslint-disable-next-line no-control-regex
  return /^[\u0000-ÿ]*$/.test(value) ? PDFString.of(value) : PDFHexString.fromText(value);
}

/** The appearance stream, as a form XObject whose BBox is the annotation rect. */
function appearanceStream(
  context: WriteContext,
  input: AnnotationInput,
  rect: { x: number; y: number; width: number; height: number },
  image: PDFImage | undefined,
  measured: MeasureDrawing | null,
): PDFRef {
  const { document, font } = context;
  const textLines =
    input.geometry.kind === 'freeText' || input.geometry.kind === 'callout'
      ? wrapText(input.contents, font, input.style.fontSize, input.geometry.rect.width)
      : [];

  const stampText =
    input.stampLabel === undefined || input.geometry.kind !== 'stamp'
      ? undefined
      : placeStampLabel(toSingleLine(input.stampLabel), input.geometry.rect, font);

  const operators = buildAppearance(input.geometry, {
    style: input.style,
    fontName: 'Helv',
    textLines,
    ...(image === undefined ? {} : { imageName: 'Im0' }),
    ...(stampText === undefined ? {} : { stampText }),
    ...(measured === null ? {} : { caption: measured.caption }),
  });

  const resources: PdfDictLiteral = {};
  if (input.geometry.kind === 'highlight') {
    // Multiply keeps the words under a highlight readable.
    resources['ExtGState'] = { GSH: { Type: 'ExtGState', BM: 'Multiply' } };
  }
  if (textLines.length > 0 || stampText !== undefined || measured !== null) {
    resources['Font'] = { Helv: font.ref };
  }
  if (image !== undefined) {
    resources['XObject'] = { Im0: image.ref };
  }

  const stream = document.context.flateStream(operators, {
    Type: 'XObject',
    Subtype: 'Form',
    FormType: 1,
    BBox: [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height],
    Resources: resources,
  });
  return document.context.register(stream);
}

/**
 * `/RD`, the difference between the annotation rectangle and the shape drawn
 * inside it.
 *
 * A stroke is centred on the shape's edge, so the rectangle has to be larger
 * than the shape or the stroke would be clipped. Without `/RD` a reader — this
 * one included — would take the padded rectangle for the shape itself and the
 * shape would creep outwards a little with every change.
 */
function rectDifferences(
  outer: { x: number; y: number; width: number; height: number },
  inner: { x: number; y: number; width: number; height: number },
): number[] {
  return [
    inner.x - outer.x,
    inner.y - outer.y,
    outer.x + outer.width - (inner.x + inner.width),
    outer.y + outer.height - (inner.y + inner.height),
  ].map((value) => Math.max(0, Number(value.toFixed(4))));
}

/** Entries that depend on the annotation's kind. */
function geometryEntries(
  geometry: AnnotationGeometry,
  style: AnnotationStyle,
  rect: { x: number; y: number; width: number; height: number },
): PdfDictLiteral {
  switch (geometry.kind) {
    case 'highlight':
    case 'underline':
    case 'strikeOut':
    case 'squiggly':
      return { QuadPoints: geometry.quads.flat() };
    case 'note':
      return { Name: 'Comment', Open: false };
    case 'freeText':
      return { DA: PDFString.of(defaultAppearance(style)), Q: 0 };
    case 'callout':
      return {
        DA: PDFString.of(defaultAppearance(style)),
        IT: 'FreeTextCallout',
        CL: geometry.callout.flatMap((point) => [point.x, point.y]),
        LE: 'OpenArrow',
        RD: rectDifferences(rect, geometry.rect),
      };
    case 'line':
      return { L: [geometry.from.x, geometry.from.y, geometry.to.x, geometry.to.y] };
    case 'arrow':
      return {
        L: [geometry.from.x, geometry.from.y, geometry.to.x, geometry.to.y],
        LE: ['None', 'OpenArrow'],
      };
    case 'polygon':
    case 'polyline':
      return { Vertices: geometry.vertices.flatMap((point) => [point.x, point.y]) };
    case 'ink':
      return {
        InkList: geometry.strokes.map((stroke) => stroke.flatMap((point) => [point.x, point.y])),
      };
    case 'square':
    case 'circle':
      return { RD: rectDifferences(rect, geometry.rect) };
    case 'stamp':
    case 'imageStamp':
      return { RD: rectDifferences(rect, geometry.rect) };
  }
}

/** The `/DA` string a free text annotation needs, in PDF's own shorthand. */
function defaultAppearance(style: AnnotationStyle): string {
  const { r, g, b } = style.textColor;
  return `${r} ${g} ${b} rg /Helv ${style.fontSize} Tf`;
}

function borderEntries(style: AnnotationStyle): PdfDictLiteral {
  const width = Math.max(0, style.borderWidth);
  const dash = Math.max(1, width) * 3;
  return {
    BS:
      style.borderStyle === 'dashed'
        ? { W: width, S: 'D', D: [dash, Math.max(1, width) * 2] }
        : { W: width, S: 'S' },
  };
}

/**
 * Creates one annotation on a page and returns the id it was given.
 *
 * The id is written to `/NM`, so it survives the rewrite every change makes
 * and the comments panel can keep pointing at the same annotation.
 */
export function writeAnnotation(
  context: WriteContext,
  page: PDFPage,
  input: AnnotationInput,
  id: string,
  timestamps: { createdAt: Date; modifiedAt: Date },
): void {
  const { document } = context;
  const measured = measureDrawing(input, context.font);
  const rect = boxFor(input, measured);
  const image = input.imageToken === undefined ? undefined : context.images.get(input.imageToken);
  const appearance = appearanceStream(context, input, rect, image, measured);

  const entries: PdfDictLiteral = {
    Type: 'Annot',
    Subtype: SUBTYPES[input.geometry.kind],
    Rect: [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height],
    NM: PDFString.of(id),
    F: FLAG_PRINT,
    C: colorArray(input.style.color),
    CA: input.style.opacity,
    CreationDate: PDFString.of(toPdfDate(timestamps.createdAt)),
    M: PDFString.of(toPdfDate(timestamps.modifiedAt)),
    AP: { N: appearance },
    P: page.ref,
    ...borderEntries(input.style),
    ...geometryEntries(input.geometry, input.style, rect),
    ...((measured?.entries ?? {}) as PdfDictLiteral),
  };

  // A measurement's comment is its value.
  const contents = measured?.text ?? input.contents;
  if (input.style.fillColor !== null) entries['IC'] = colorArray(input.style.fillColor);
  if (contents !== '') entries['Contents'] = textValue(contents);
  if (input.author !== '') entries['T'] = textValue(input.author);
  if (input.subject !== '') entries['Subj'] = textValue(input.subject);
  if (input.stampLabel !== undefined) entries['Name'] = PDFName.of(stampName(input.stampLabel));

  const dict = document.context.obj(entries);
  turnNewAppearance(context, dict, input, rect);
  page.node.addAnnot(document.context.register(dict));
}

/** Turns a stamp whose appearance was just drawn upright in its own box. */
function turnNewAppearance(
  context: WriteContext,
  dict: PDFDict,
  input: AnnotationInput,
  outer: { x: number; y: number; width: number; height: number },
): void {
  if (!isStampKind(input.geometry.kind) || !('rect' in input.geometry)) return;
  if (!isTurned(input.rotation)) {
    clearTurn(dict);
    return;
  }
  const appearance = normalAppearance(dict);
  if (appearance === undefined) return;
  const { rect } = input.geometry;
  const rotation = input.rotation ?? 0;
  applyStampPlacement(
    context.document,
    dict,
    appearance,
    placeStamp(outer, rect, rect, rotation),
    rect,
    rotation,
  );
}

/**
 * Fits a stamp whose appearance is kept, such as a signature from an earlier
 * session, to its new box and turn: the box its picture was drawn in is
 * mapped exactly onto the one asked for.
 */
function refitKeptAppearance(context: WriteContext, dict: PDFDict, input: AnnotationInput): void {
  if (!('rect' in input.geometry)) return;
  const appearance = normalAppearance(dict);
  const bbox = appearance === undefined ? undefined : bboxOf(appearance);
  if (appearance === undefined || bbox === undefined) return;

  // The picture was drawn inset from its box by the padding a stroke needs.
  const pad = -boundsOf(
    { kind: 'stamp', rect: { x: 0, y: 0, width: 0, height: 0 } },
    input.style.borderWidth,
  ).x;
  const inner = {
    x: bbox.x + pad,
    y: bbox.y + pad,
    width: Math.max(1, bbox.width - pad * 2),
    height: Math.max(1, bbox.height - pad * 2),
  };
  const { rect } = input.geometry;
  const rotation = input.rotation ?? 0;
  applyStampPlacement(
    context.document,
    dict,
    appearance,
    placeStamp(bbox, inner, rect, rotation),
    rect,
    rotation,
  );
}

/** The annotation's rectangle: its shape, and a measurement's caption beside it. */
function boxFor(
  input: AnnotationInput,
  measured: MeasureDrawing | null,
): { x: number; y: number; width: number; height: number } {
  const shape = boundsOf(input.geometry, input.style.borderWidth);
  return measured === null ? shape : unionRect(shape, measured.captionBox);
}

/**
 * Sizes a stamp's label to its box and centres it.
 *
 * A stamp is read at a glance, so the label fills the box rather than sitting
 * at whatever size the tool happened to be set to.
 */
function placeStampLabel(
  text: string,
  rect: { x: number; y: number; width: number; height: number },
  font: PDFFont,
): { text: string; size: number; x: number; y: number } {
  const usableWidth = rect.width * 0.84;
  let size = Math.min(rect.height * 0.5, 36);

  for (let attempt = 0; attempt < 12 && size > 4; attempt += 1) {
    if (widthOfText(font, text, size) <= usableWidth) break;
    size -= Math.max(0.5, size * 0.12);
  }

  const width = widthOfText(font, text, size);
  return {
    text,
    size,
    x: rect.x + Math.max(0, (rect.width - width) / 2),
    // Roughly centred on the cap height, which reads better than the baseline.
    y: rect.y + (rect.height - size * 0.72) / 2,
  };
}

/** Font metrics, with an estimate for a character the font refuses. */
function widthOfText(font: PDFFont, text: string, size: number): number {
  try {
    return font.widthOfTextAtSize(text, size);
  } catch {
    return text.length * size * 0.5;
  }
}

/** A stamp's `/Name`, which readers show when they have no appearance to draw. */
function stampName(label: string): string {
  return `PF${label.replace(/[^A-Za-z0-9]/g, '')}`;
}

/** Replaces an annotation's appearance and entries after it has been changed. */
export function rewriteAnnotation(
  context: WriteContext,
  dict: PDFDict,
  input: AnnotationInput,
  annotation: Annotation,
  modifiedAt: Date,
): void {
  const { document } = context;
  const measured = measureDrawing(input, context.font);
  const rect = boxFor(input, measured);
  const image = input.imageToken === undefined ? undefined : context.images.get(input.imageToken);

  /**
   * A stamp with neither a label nor a picture to hand is one whose
   * appearance PaperForge cannot draw again — a signature, or a picture
   * stamped in an earlier session. Its appearance is kept exactly as it is
   * and the rectangle is moved instead: a form appearance is mapped onto the
   * rectangle, so moving the one moves the other, and the picture survives.
   */
  const canRedraw =
    input.geometry.kind !== 'stamp' || input.stampLabel !== undefined || image !== undefined;

  const set = (key: string, value: PdfValue | PdfObjectValue): void => {
    dict.set(PDFName.of(key), document.context.obj(value as PdfDictLiteral));
  };

  set('Rect', [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height]);
  set('C', colorArray(input.style.color));
  set('CA', input.style.opacity);
  if (canRedraw) set('AP', { N: appearanceStream(context, input, rect, image, measured) });
  set('M', PDFString.of(toPdfDate(modifiedAt)));
  for (const [key, value] of Object.entries(borderEntries(input.style))) set(key, value);
  for (const [key, value] of Object.entries(geometryEntries(input.geometry, input.style, rect))) {
    set(key, value);
  }

  if (input.style.fillColor === null) dict.delete(PDFName.of('IC'));
  else set('IC', colorArray(input.style.fillColor));

  // A stamp PaperForge made is turned and fitted through its appearance; one
  // made elsewhere keeps being moved by its rectangle alone, as before.
  if (isStampKind(input.geometry.kind)) {
    if (canRedraw) turnNewAppearance(context, dict, input, rect);
    else if (annotation.id.startsWith('pf-')) refitKeptAppearance(context, dict, input);
  }

  if (measured !== null) {
    for (const [key, value] of Object.entries(measured.entries)) {
      set(key, value as PdfValue | PdfObjectValue);
    }
  }
  const contents = measured?.text ?? input.contents;
  setOrDelete(dict, 'Contents', contents === '' ? null : textValue(contents));
  setOrDelete(dict, 'T', input.author === '' ? null : textValue(input.author));
  setOrDelete(dict, 'Subj', input.subject === '' ? null : textValue(input.subject));
  setOrDelete(dict, 'PFStatus', annotation.resolved ? PDFString.of('resolved') : null);
}

function setOrDelete(dict: PDFDict, key: string, value: PDFString | PDFHexString | null): void {
  if (value === null) dict.delete(PDFName.of(key));
  else dict.set(PDFName.of(key), value);
}

/** Marks or unmarks an annotation as dealt with, which is PaperForge's own flag. */
export function setResolved(dict: PDFDict, resolved: boolean): void {
  setOrDelete(dict, 'PFStatus', resolved ? PDFString.of('resolved') : null);
}

/** Removes annotations from a page by reference. */
export function removeAnnotations(page: PDFPage, refs: ReadonlySet<string>): number {
  const annots = page.node.Annots();
  if (annots === undefined) return 0;

  let removed = 0;
  for (let index = annots.size() - 1; index >= 0; index -= 1) {
    const entry = annots.get(index);
    if (entry instanceof PDFRef && refs.has(entry.toString())) {
      annots.remove(index);
      removed += 1;
    }
  }
  return removed;
}

/** Embeds Helvetica once per document, for every appearance that draws text. */
export function embedAppearanceFont(document: PDFDocument): PDFFont {
  return document.embedStandardFont(StandardFonts.Helvetica);
}

/** Reads a number array, which several annotation entries are. */
export function numbersFrom(value: unknown): number[] {
  if (!(value instanceof PDFArray)) return [];
  const numbers: number[] = [];
  for (let index = 0; index < value.size(); index += 1) {
    const entry = value.get(index);
    numbers.push(entry instanceof PDFNumber ? entry.asNumber() : 0);
  }
  return numbers;
}
