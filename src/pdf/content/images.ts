import type { ByteRange, ContentOperation } from './parser';
import { findImageGroups, type ImageGroup, type ImageMark } from './imageGroups';
import { applyMatrix, invert, matrixRotation, multiply, walkContent, type Matrix } from './state';
import { nameOf, numberOf, type ContentValue } from './values';

export { placementMatrix, placementOf, type ImageBox } from './placementGeometry';

/**
 * The images a page draws.
 *
 * A page draws an image by mapping the unit square onto the page with the
 * current transform and then saying `Do`. Everything the editor needs follows
 * from that one matrix: where the image sits, how big it is, how far it is
 * turned, and whether it has been mirrored.
 */

export interface ImageFacts {
  /** Pixels across and down, as the image itself states them. */
  width: number;
  height: number;
  /** False for a form XObject, which is a drawing rather than a picture. */
  isImage: boolean;
  /** True when the image carries its own transparency. */
  hasAlpha: boolean;
}

export type XObjectLookup = (name: string) => ImageFacts | undefined;

/** How see-through a named transparency state makes what is drawn with it. */
export type AlphaLookup = (name: string) => number | undefined;

/**
 * A form XObject, opened so the pictures it draws can be found.
 *
 * Everything is the form's own: its content, its `/Matrix`, its `/BBox` and
 * its resources (or those of whatever draws it, when it has none).
 */
export interface FormSource {
  /** Names the form's object, so the same form is known wherever it is drawn. */
  key: string;
  /** The form's content, decoded, which inline pictures are read from. */
  bytes: Uint8Array;
  matrix: Matrix;
  /** The form's clip, in its own space; null when it states none. */
  bbox: Rect | null;
  operations: readonly ContentOperation[];
  lookup: XObjectLookup;
  alphas?: AlphaLookup;
  openForm?: FormOpener;
}

/**
 * Opens a form by resource name. Undefined when the name is not a form;
 * null when it is one that cannot be read.
 */
export type FormOpener = (name: string) => FormSource | null | undefined;

/** Why a picture the page shows was not offered for editing. */
export type SkippedImageReason = 'form-unreadable' | 'form-too-deep';

/** One step into a form: the `Do` that draws it, in the stream that draws it. */
export interface FormStep {
  /** The form's resource name in the stream that draws it. */
  resourceName: string;
  /** Index of that `Do` in the drawing stream's operations. */
  operationIndex: number;
  /** The form's object, as {@link FormSource.key} names it. */
  ref: string;
  /** The transform from the form's own space to the page's. */
  ctm: Matrix;
  /** The form's `/BBox`, in its own space. */
  bbox: Rect | null;
}

export interface InlineImage {
  /** Its dictionary, with the short keys spelled out. */
  entries: Map<string, ContentValue>;
  /** The bytes between `ID` and `EI`, still encoded as its filters say. */
  data: Uint8Array;
}

/** Forms inside forms deeper than this are not walked into. */
export const MAX_FORM_DEPTH = 8;

export interface ImagePlacement {
  /**
   * An XObject the resources name, or an inline image whose samples sit in
   * the content stream itself between `BI` and `EI`.
   */
  kind: 'xobject' | 'inline';
  /**
   * The forms the picture is drawn from inside, outermost first; empty when
   * the page draws it itself. Every range and index below then refers to the
   * innermost form's content stream rather than the page's.
   */
  forms: FormStep[];
  /** The innermost form's `/BBox` in user space, which clips the picture. */
  formClip: Rect | null;
  /** Index of the `Do` operation (an inline image's `ID`) in the parsed stream. */
  operationIndex: number;
  /** Resource name of the image, without its slash; `inline` for an inline image. */
  resourceName: string;
  /** An inline picture's dictionary and samples; null for an XObject. */
  inline: InlineImage | null;
  /** The `/Name Do` operation, or `BI … EI`, for replacing it outright. */
  operationRange: ByteRange;
  /** Where the operand naming the image sits; the whole image when inline. */
  nameRange: ByteRange;
  /** The transform that maps the unit square onto the page. */
  matrix: Matrix;
  /** The box the image occupies in user space. */
  bounds: { x: number; y: number; width: number; height: number };
  /** How far the image is turned, in degrees clockwise. */
  rotation: number;
  /** True when the image is mirrored along its own axes. */
  flippedX: boolean;
  flippedY: boolean;
  /**
   * The part of the image that shows, in its own square, when the page clips
   * it to less than all of it. Null means all of it shows.
   */
  crop: { x: number; y: number; width: number; height: number } | null;
  /** How see-through the page draws it, where 1 is solid. */
  opacity: number;
  facts: ImageFacts;
  /**
   * The `q … Q` that draws this picture and nothing else, with its clip and
   * transparency; null when the picture shares its drawing state.
   */
  group: ImageGroup | null;
  /** PaperForge's marking around a picture it added, which names it. */
  mark: ImageMark | null;
}

/** Every image a content stream draws, in the order it draws them. */
export function extractImages(
  operations: readonly ContentOperation[],
  lookup: XObjectLookup,
  options: ExtractOptions = {},
): ImagePlacement[] {
  const images: ImagePlacement[] = [];
  /** Pictures found inside forms, which keep their own groups. */
  const nested: ImagePlacement[] = [];
  const opened = options.opened ?? [];
  /**
   * The clip in force for the image about to be drawn, in user space. Only a
   * clip set alongside the image counts: an outer one belongs to the page
   * rather than to the picture, and is not the reader's crop.
   */
  let rect: Rect | null = null;
  let clip: Rect | null = null;
  // Transparency is graphics state: it outlasts a `q` and comes back at `Q`.
  let opacity = options.opacity ?? 1;
  const opacities: number[] = [];

  walkContent(operations, {
    ...(options.ctm === undefined ? {} : { ctm: options.ctm }),
    onOperation: (context) => {
      const { operation, state } = context;

      if (operation.operator === 'q' || operation.operator === 'Q') {
        rect = null;
        clip = null;
        if (operation.operator === 'q') opacities.push(opacity);
        else opacity = opacities.pop() ?? 1;
        return;
      }
      if (operation.operator === 'gs') {
        // Opacity is not an operand of the drawing: it is set in the graphics
        // state, which the page's resources name.
        const name = nameOf(operation.operands[0]);
        const alpha = name === null ? undefined : options.alphas?.(name);
        if (alpha !== undefined) opacity = alpha;
        return;
      }
      if (operation.operator === 're') {
        rect = rectangleOf(operation, state.ctm);
        return;
      }
      if (operation.operator === 'W' || operation.operator === 'W*') {
        clip = rect;
        return;
      }
      let image: DrawnImage | null = null;

      if (operation.operator === 'ID') {
        image = inlineImage(operations, context.index, options.bytes);
      } else if (operation.operator === 'Do') {
        const name = nameOf(operation.operands[0]);
        const nameRange = operation.operandRanges[0];
        if (name === null || nameRange === undefined) return;
        const facts = lookup(name);
        if (facts?.isImage === true) {
          image = {
            kind: 'xobject',
            inline: null,
            resourceName: name,
            operationRange: operation.range,
            nameRange,
            facts,
          };
        } else {
          nested.push(...formImages(name, context.index, state.ctm, opacity, options, opened));
          return;
        }
      }
      if (image === null) return;

      images.push({
        ...image,
        forms: [],
        formClip: null,
        operationIndex: context.index,
        matrix: state.ctm,
        bounds: boundsOf(state.ctm),
        rotation: matrixRotation(state.ctm),
        // A mirrored image has a negative scale down one of its axes.
        flippedX: state.ctm.a * state.ctm.d - state.ctm.b * state.ctm.c < 0,
        flippedY: state.ctm.d < 0 && state.ctm.a >= 0,
        crop: cropOf(clip, state.ctm),
        opacity,
        group: null,
        mark: null,
      });
      clip = null;
      rect = null;
    },
  });

  if (images.length === 0) return nested;
  const drawn = new Set(images.map((image) => image.operationIndex));
  const { groups, marks } = findImageGroups(operations, (index) => drawn.has(index), options.ctm);
  const own = images.map((image) => ({
    ...image,
    group: groups.get(image.operationIndex) ?? null,
    mark: marks.get(image.operationIndex) ?? null,
  }));
  // In the order the page draws them: a form's pictures where the form is.
  return [...own, ...nested].sort((first, second) => drawOrder(first) - drawOrder(second));
}

export interface ExtractOptions {
  ctm?: Matrix;
  alphas?: AlphaLookup;
  /** Opens the form XObjects the stream draws, so their pictures are found too. */
  openForm?: FormOpener;
  /** Told about pictures the page shows that are not offered for editing. */
  onSkipped?: (reason: SkippedImageReason) => void;
  /** How see-through the stream is drawn to begin with. */
  opacity?: number;
  /** The forms already open around this stream, outermost first. */
  opened?: readonly string[];
  /** The stream the operations were parsed from, for an inline picture's samples. */
  bytes?: Uint8Array;
}

/** Where a picture comes in the page's drawing: the outermost `Do` that draws it. */
function drawOrder(image: ImagePlacement): number {
  return image.forms[0]?.operationIndex ?? image.operationIndex;
}

/**
 * The pictures a form draws, placed as this drawing of it places them.
 *
 * A form is drawn with its `/Matrix` on top of the transform in force, clipped
 * to its `/BBox`, and its own content may draw further forms; all of that is
 * carried, so a picture deep inside reports where it really is on the page.
 */
function formImages(
  name: string,
  index: number,
  ctm: Matrix,
  opacity: number,
  options: ExtractOptions,
  opened: readonly string[],
): ImagePlacement[] {
  const source = options.openForm?.(name);
  if (source === undefined) return [];
  if (source === null) {
    options.onSkipped?.('form-unreadable');
    return [];
  }
  // A form that draws itself, directly or not, would never end.
  if (opened.includes(source.key)) return [];
  if (opened.length >= MAX_FORM_DEPTH) {
    options.onSkipped?.('form-too-deep');
    return [];
  }

  const inner = multiply(source.matrix, ctm);
  const step: FormStep = {
    resourceName: name,
    operationIndex: index,
    ref: source.key,
    ctm: inner,
    bbox: source.bbox,
  };
  const found = extractImages(source.operations, source.lookup, {
    ctm: inner,
    opacity,
    bytes: source.bytes,
    opened: [...opened, source.key],
    ...(source.alphas === undefined ? {} : { alphas: source.alphas }),
    ...(source.openForm === undefined ? {} : { openForm: source.openForm }),
    ...(options.onSkipped === undefined ? {} : { onSkipped: options.onSkipped }),
  });
  const clip = source.bbox === null ? null : rectThrough(source.bbox, inner);
  return found.map((image) => ({
    ...image,
    forms: [step, ...image.forms],
    formClip: image.forms.length === 0 ? clip : image.formClip,
  }));
}

/** What is known of a picture from the operation that draws it. */
type DrawnImage = Pick<
  ImagePlacement,
  'kind' | 'inline' | 'resourceName' | 'operationRange' | 'nameRange' | 'facts'
>;

/** The keys an inline image's dictionary may spell short, spelled out. */
const INLINE_KEYS: Record<string, string> = { W: 'Width', H: 'Height', IM: 'ImageMask' };

/**
 * An inline image, from its `ID`: the samples sit in the content stream, so
 * there is no resource to name, and `BI` before it starts what is drawn.
 */
function inlineImage(
  operations: readonly ContentOperation[],
  index: number,
  bytes: Uint8Array | undefined,
): DrawnImage | null {
  const id = operations[index];
  const begin = operations[index - 1];
  const data = id?.inlineImageData;
  if (id === undefined || data === undefined || begin?.operator !== 'BI') return null;

  const entries = inlineEntries(id.operands);
  const range = { start: begin.range.start, end: id.range.end };
  return {
    kind: 'inline',
    inline: { entries, data: bytes?.subarray(data.start, data.end) ?? new Uint8Array(0) },
    resourceName: 'inline',
    operationRange: range,
    nameRange: range,
    facts: {
      width: numberOf(entries.get('Width')),
      height: numberOf(entries.get('Height')),
      isImage: true,
      hasAlpha: false,
    },
  };
}

/** An inline image's dictionary, which `ID` takes as its operands. */
export function inlineEntries(operands: readonly ContentValue[]): Map<string, ContentValue> {
  const entries = new Map<string, ContentValue>();
  for (let index = 0; index + 1 < operands.length; index += 2) {
    const key = nameOf(operands[index]);
    const value = operands[index + 1];
    if (key === null || value === undefined) continue;
    entries.set(INLINE_KEYS[key] ?? key, value);
  }
  return entries;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The upright box a rectangle covers once a matrix has had its way with it. */
function rectThrough(rect: Rect, matrix: Matrix): Rect {
  const corners = [
    applyMatrix(matrix, rect.x, rect.y),
    applyMatrix(matrix, rect.x + rect.width, rect.y),
    applyMatrix(matrix, rect.x, rect.y + rect.height),
    applyMatrix(matrix, rect.x + rect.width, rect.y + rect.height),
  ];
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** A rectangle an `re` operator draws, in user space. */
function rectangleOf(operation: ContentOperation, ctm: Matrix): Rect | null {
  const operands = operation.operands.slice(0, 4);
  if (operands.length < 4 || operands.some((operand) => operand.kind !== 'number')) return null;
  const [x, y, width, height] = operands.map((operand) => numberOf(operand)) as [
    number,
    number,
    number,
    number,
  ];
  return rectThrough({ x, y, width, height }, ctm);
}

/** A clip in user space, as the part of the image it leaves showing. */
function cropOf(clip: Rect | null, ctm: Matrix): Rect | null {
  if (clip === null) return null;
  const undo = invert(ctm);
  if (undo === null) return null;

  const first = applyMatrix(undo, clip.x, clip.y);
  const second = applyMatrix(undo, clip.x + clip.width, clip.y + clip.height);
  const x = Math.max(0, Math.min(first.x, second.x));
  const y = Math.max(0, Math.min(first.y, second.y));
  const width = Math.min(1, Math.max(first.x, second.x)) - x;
  const height = Math.min(1, Math.max(first.y, second.y)) - y;

  // A clip that leaves the whole image showing is not a crop.
  if (width >= 0.999 && height >= 0.999) return null;
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

/** The box the unit square occupies once a matrix has had its way with it. */
export function boundsOf(matrix: Matrix): Rect {
  return rectThrough({ x: 0, y: 0, width: 1, height: 1 }, matrix);
}
