import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  type PDFDocument,
} from 'pdf-lib';
import { AppError } from '@shared/errors/appError';
import { spliceBytes } from '@pdf/content/editText';
import {
  boundsOf,
  extractImages,
  type FormOpener,
  type ImagePlacement,
  type Rect,
} from '@pdf/content/images';
import { contentBytes, decodeStream, resourcesOf } from '@pdf/content/pageContent';
import { parseContent, type ContentOperation } from '@pdf/content/parser';
import { invert, multiply, type Matrix } from '@pdf/content/state';
import { nameOf } from '@pdf/content/values';
import { ownResources, readAlphas, readXObjects } from './imageResources';
import { setPageContent } from './text';

/**
 * Pictures drawn from inside form XObjects.
 *
 * A form is a drawing of its own, kept once and drawn wherever a content
 * stream says `/Name Do`: a letterhead on every page, a logo twice on one. A
 * picture inside it is changed in the form's content stream. When the form is
 * drawn more than once, that changes every drawing of it; to change only the
 * one the reader is pointing at, the form is copied first and that one drawing
 * pointed at the copy.
 */

/** Names a form XObject PaperForge copied so one drawing of it could change alone. */
export const COPIED_FORM_PREFIX = 'PFForm';

/** Which drawings of a shared form a change applies to. */
export type FormScope = 'this' | 'all';

/** Opens the forms a resource dictionary names, reading each form once. */
export function formOpener(
  document: PDFDocument,
  resources: PDFDict | undefined,
  parsed: Map<
    string,
    { bytes: Uint8Array; operations: readonly ContentOperation[] } | null
  > = new Map(),
): FormOpener {
  return (name) => {
    const found = formNamed(document, resources, name);
    if (found === undefined) return undefined;
    const key = found.ref.toString();

    if (!parsed.has(key)) {
      const bytes = decodeStream(found.stream);
      parsed.set(key, bytes === null ? null : { bytes, operations: parseContent(bytes) });
    }
    const read = parsed.get(key);
    if (read == null) return null;

    const formResources = ownResourcesOf(document, found.stream) ?? resources;
    const images = readXObjects(document, formResources);
    const alphas = readAlphas(document, formResources);
    return {
      key,
      matrix: matrixOf(found.stream.dict.lookup(PDFName.of('Matrix'))),
      bbox: rectOf(found.stream.dict.lookup(PDFName.of('BBox'))),
      ...read,
      lookup: (inner) => images.get(inner),
      alphas: (inner) => alphas.get(inner),
      openForm: formOpener(document, formResources, parsed),
    };
  };
}

/**
 * How many times each form is drawn across the document's pages, counting a
 * form inside a form once for every drawing of the outer one.
 */
export function formUsesOf(document: PDFDocument): Map<string, number> {
  const totals = new Map<string, number>();
  const within = new Map<string, Map<string, number>>();

  const drawsIn = (
    bytes: Uint8Array,
    resources: PDFDict | undefined,
    open: readonly string[],
  ): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const operation of parseContent(bytes)) {
      if (operation.operator !== 'Do') continue;
      const name = nameOf(operation.operands[0]);
      const form = name === null ? undefined : formNamed(document, resources, name);
      if (form === undefined) continue;

      const key = form.ref.toString();
      add(counts, key, 1);
      if (open.includes(key)) continue;
      let inner = within.get(key);
      if (inner === undefined) {
        const formBytes = decodeStream(form.stream);
        inner =
          formBytes === null
            ? new Map<string, number>()
            : drawsIn(formBytes, ownResourcesOf(document, form.stream) ?? resources, [
                ...open,
                key,
              ]);
        within.set(key, inner);
      }
      for (const [innerKey, count] of inner) add(counts, innerKey, count);
    }
    return counts;
  };

  for (const page of document.getPages()) {
    const counts = drawsIn(contentBytes(document, page), resourcesOf(document, page), []);
    for (const [key, count] of counts) add(totals, key, count);
  }
  return totals;
}

/** What a change to a picture inside a form works on. */
export interface FormTarget {
  /** The innermost form's content, decoded. */
  bytes: Uint8Array;
  /** The innermost form's own resources, made when it only inherits them. */
  resources: () => PDFDict;
}

/** One level of the chain being walked: what draws the next form. */
interface Level {
  bytes: Uint8Array;
  /** The resources names in `bytes` are looked up in. */
  lookupResources: PDFDict | undefined;
  /** Resources a new name can be added to. */
  ownResources: () => PDFDict;
  write: (bytes: Uint8Array) => void;
}

/**
 * Changes a picture inside a form, in the form's own content stream.
 *
 * With `this`, every form on the way down that is drawn more than once is
 * copied, and the drawing on the way down pointed at the copy, so no other
 * drawing changes. `grow` is where the picture will be on the page: each form
 * on the way grows its `/BBox` to take it in, or the picture would be clipped
 * away. Returns false when `change` declines.
 */
export function editInForm(
  document: PDFDocument,
  pageIndex: number,
  placement: ImagePlacement,
  scope: FormScope,
  change: (target: FormTarget) => Uint8Array | null,
  grow: Matrix | null,
): boolean {
  const uses = scope === 'this' ? formUsesOf(document) : null;
  const page = document.getPage(pageIndex);
  let level: Level = {
    bytes: contentBytes(document, page),
    lookupResources: resourcesOf(document, page),
    ownResources: () => ownResources(document, page),
    write: (bytes) => setPageContent(document, pageIndex, bytes),
  };
  const refs: PDFRef[] = [];

  for (const step of placement.forms) {
    const operation = parseContent(level.bytes)[step.operationIndex];
    const nameRange = operation?.operandRanges[0];
    const found =
      operation?.operator === 'Do' && nameOf(operation.operands[0]) === step.resourceName
        ? formNamed(document, level.lookupResources, step.resourceName)
        : undefined;
    if (found === undefined || nameRange === undefined || found.ref.toString() !== step.ref) {
      throw stale(placement);
    }

    let ref = found.ref;
    if ((uses?.get(step.ref) ?? 0) > 1) {
      // Only this drawing changes: it draws a copy, under a name of its own.
      ref = document.context.register(
        PDFRawStream.of(found.stream.dict.clone(document.context), found.stream.getContents()),
      );
      const name = freshName(document, level.ownResources());
      level.bytes = spliceBytes(level.bytes, nameRange, `/${name}`);
      level.write(level.bytes);
      xobjectsOf(document, level.ownResources()).set(PDFName.of(name), ref);
    }

    const stream = streamAt(document, ref);
    const bytes = decodeStream(stream);
    if (bytes === null) throw stale(placement);
    const inherited = level.lookupResources;
    const formRef = ref;
    level = {
      bytes,
      lookupResources: ownResourcesOf(document, stream) ?? inherited,
      ownResources: () => ownFormResources(document, formRef, inherited),
      write: (written) => writeForm(document, formRef, written),
    };
    refs.push(ref);
  }

  const changed = change({ bytes: level.bytes, resources: level.ownResources });
  if (changed === null) return false;
  level.write(changed);

  if (grow !== null) {
    placement.forms.forEach((step, index) => {
      const ref = refs[index];
      const undo = invert(step.ctm);
      if (ref !== undefined && undo !== null)
        growBox(document, ref, boundsOf(multiply(grow, undo)));
    });
  }
  return true;
}

/** The resources a picture is named in: the innermost form's, or the page's. */
export function resourcesForImage(
  document: PDFDocument,
  pageIndex: number,
  placement: ImagePlacement,
): PDFDict | undefined {
  let resources = resourcesOf(document, document.getPage(pageIndex));
  for (const step of placement.forms) {
    const found = formNamed(document, resources, step.resourceName);
    if (found === undefined) throw stale(placement);
    resources = ownResourcesOf(document, found.stream) ?? resources;
  }
  return resources;
}

/**
 * How many pictures the page's annotations draw in their appearances — a
 * stamp, a signature. They belong to the annotation, which the comment tools
 * move and remove, so the image editor leaves them alone.
 */
export function appearanceImageCount(document: PDFDocument, pageIndex: number): number {
  const annots = document.getPage(pageIndex).node.lookup(PDFName.of('Annots'));
  if (!(annots instanceof PDFArray)) return 0;

  let count = 0;
  for (const entry of annots.asArray()) {
    const annotation = document.context.lookup(entry);
    if (!(annotation instanceof PDFDict)) continue;
    const appearances = annotation.lookup(PDFName.of('AP'));
    const normal = appearances instanceof PDFDict ? appearances.get(PDFName.of('N')) : undefined;
    if (normal === undefined) continue;
    // One appearance, or one for each state, as a checkbox has.
    const resolved = document.context.lookup(normal);
    const candidates =
      resolved instanceof PDFDict && !(resolved instanceof PDFStream)
        ? resolved.values()
        : [normal];
    for (const candidate of candidates) {
      if (!(candidate instanceof PDFRef)) continue;
      const holder = document.context.obj({ XObject: { Ap: candidate } });
      const form = formOpener(document, holder)('Ap');
      if (form == null) continue;
      count += extractImages(form.operations, form.lookup, {
        bytes: form.bytes,
        ...(form.openForm === undefined ? {} : { openForm: form.openForm }),
      }).length;
    }
  }
  return count;
}

function stale(placement: ImagePlacement): AppError {
  return new AppError('pdf/malformed-content', {
    message: 'That image is no longer where it was; close the editor and try again.',
    details: `form ${placement.forms.map((step) => step.resourceName).join(' > ')}`,
  });
}

function add(counts: Map<string, number>, key: string, count: number): void {
  counts.set(key, (counts.get(key) ?? 0) + count);
}

/** The form a resource dictionary names, when it is one. */
function formNamed(
  document: PDFDocument,
  resources: PDFDict | undefined,
  name: string,
): { ref: PDFRef; stream: PDFStream } | undefined {
  const xobjects = resources?.lookup(PDFName.of('XObject'));
  if (!(xobjects instanceof PDFDict)) return undefined;
  const ref = xobjects.get(PDFName.of(name));
  if (!(ref instanceof PDFRef)) return undefined;
  const stream = document.context.lookup(ref);
  if (!(stream instanceof PDFStream)) return undefined;
  const subtype = stream.dict.lookup(PDFName.of('Subtype'));
  if (!(subtype instanceof PDFName) || subtype.decodeText() !== 'Form') return undefined;
  return { ref, stream };
}

function streamAt(document: PDFDocument, ref: PDFRef): PDFStream {
  const stream = document.context.lookup(ref);
  if (!(stream instanceof PDFStream)) throw new Error(`not a stream: ${ref.toString()}`);
  return stream;
}

function ownResourcesOf(document: PDFDocument, stream: PDFStream): PDFDict | undefined {
  return document.context.lookupMaybe(stream.dict.get(PDFName.of('Resources')), PDFDict);
}

/** A form's own resources, starting from what it inherits when it has none. */
function ownFormResources(
  document: PDFDocument,
  ref: PDFRef,
  inherited: PDFDict | undefined,
): PDFDict {
  const stream = streamAt(document, ref);
  const existing = ownResourcesOf(document, stream);
  if (existing !== undefined) return existing;
  const created = inherited?.clone(document.context) ?? document.context.obj({});
  stream.dict.set(PDFName.of('Resources'), created);
  return created;
}

function xobjectsOf(document: PDFDocument, resources: PDFDict): PDFDict {
  const existing = document.context.lookupMaybe(resources.get(PDFName.of('XObject')), PDFDict);
  if (existing !== undefined) return existing;
  const created = document.context.obj({});
  resources.set(PDFName.of('XObject'), created);
  return created;
}

function freshName(document: PDFDocument, resources: PDFDict): string {
  const xobjects = xobjectsOf(document, resources);
  let index = 1;
  while (xobjects.has(PDFName.of(`${COPIED_FORM_PREFIX}${String(index)}`))) index += 1;
  return `${COPIED_FORM_PREFIX}${String(index)}`;
}

/**
 * Writes a form's content back, uncompressed as page content is: what
 * PaperForge writes it can read back, and the optimizer compresses on request.
 */
function writeForm(document: PDFDocument, ref: PDFRef, bytes: Uint8Array): void {
  const dict = streamAt(document, ref).dict.clone(document.context);
  dict.delete(PDFName.of('Filter'));
  dict.delete(PDFName.of('DecodeParms'));
  dict.delete(PDFName.of('Length'));
  document.context.assign(ref, PDFRawStream.of(dict, bytes));
}

function growBox(document: PDFDocument, ref: PDFRef, wanted: Rect): void {
  const dict = streamAt(document, ref).dict;
  const box = rectOf(dict.lookup(PDFName.of('BBox')));
  if (box === null) return;
  const left = Math.min(box.x, wanted.x);
  const bottom = Math.min(box.y, wanted.y);
  const right = Math.max(box.x + box.width, wanted.x + wanted.width);
  const top = Math.max(box.y + box.height, wanted.y + wanted.height);
  if (
    left === box.x &&
    bottom === box.y &&
    right === box.x + box.width &&
    top === box.y + box.height
  ) {
    return;
  }
  dict.set(PDFName.of('BBox'), document.context.obj([left, bottom, right, top]));
}

function numbersIn(value: unknown): number[] | null {
  if (!(value instanceof PDFArray)) return null;
  const numbers = value
    .asArray()
    .map((item) => (item instanceof PDFNumber ? item.asNumber() : NaN));
  return numbers.every(Number.isFinite) ? numbers : null;
}

function matrixOf(value: unknown): Matrix {
  const numbers = numbersIn(value);
  if (numbers?.length !== 6) return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  const [a, b, c, d, e, f] = numbers as [number, number, number, number, number, number];
  return { a, b, c, d, e, f };
}

/** A `[llx lly urx ury]` rectangle, in either corner order. */
function rectOf(value: unknown): Rect | null {
  const numbers = numbersIn(value);
  if (numbers?.length !== 4) return null;
  const [x1, y1, x2, y2] = numbers as [number, number, number, number];
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  return { x, y, width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
}
