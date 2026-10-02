import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRef,
  type PDFDocument,
  type PDFObject,
  type PDFPage,
} from 'pdf-lib';
import { deleteAnnotation } from '../sanitize/prune';
import { boundsOfPoints, touchesAny, type Rect } from './geometry';

/**
 * Comments, links and form fields under a mark.
 *
 * An annotation is not part of the page's drawing, but it is on the page: a
 * note's text, a highlight's quoted words, a field's value. One under a mark
 * goes entirely. A pop-up goes with the note it belongs to, either way round,
 * and a form field goes with all of its widgets — its value is one value, and
 * leaving it on another page would leave it in the document.
 */

const EVERYWHERE: Rect = { x: -1e9, y: -1e9, width: 2e9, height: 2e9 };

export interface AnnotationHit {
  index: number;
  value: PDFObject;
  dict: PDFDict;
  bounds: Rect;
  subtype: string;
}

/** The annotations on a page that a mark touches, and those tied to them. */
export function annotationsUnder(
  document: PDFDocument,
  page: PDFPage,
  marks: readonly Rect[],
): AnnotationHit[] {
  const annotations = document.context.lookupMaybe(page.node.get(PDFName.of('Annots')), PDFArray);
  if (annotations === undefined) return [];

  const all: AnnotationHit[] = [];
  for (let index = 0; index < annotations.size(); index += 1) {
    const value = annotations.get(index);
    const dict = document.context.lookupMaybe(value, PDFDict);
    if (dict === undefined) continue;
    const bounds = rectOf(document, dict);
    const subtype = dict.lookup(PDFName.of('Subtype'));
    all.push({
      index,
      value,
      dict,
      // An annotation without a rectangle cannot be placed, so it cannot be
      // said to be outside the mark either.
      bounds: bounds ?? EVERYWHERE,
      subtype: subtype instanceof PDFName ? subtype.decodeText() : '',
    });
  }

  const hit = new Set(all.filter((entry) => touchesAny(marks, entry.bounds)));
  // A pop-up shows its parent's text, and a parent's text is in its pop-up.
  for (const entry of all) {
    const parent = document.context.lookupMaybe(entry.dict.get(PDFName.of('Parent')), PDFDict);
    const popup = document.context.lookupMaybe(entry.dict.get(PDFName.of('Popup')), PDFDict);
    for (const other of hit) {
      if (other.dict === parent || other.dict === popup) hit.add(entry);
    }
  }
  return all.filter((entry) => hit.has(entry));
}

/**
 * Removes the annotations given, and the objects they own, from the page and
 * from the document. A widget takes its whole form field with it.
 */
export function removeAnnotations(
  document: PDFDocument,
  page: PDFPage,
  hits: readonly AnnotationHit[],
): void {
  const annotations = document.context.lookupMaybe(page.node.get(PDFName.of('Annots')), PDFArray);
  if (annotations === undefined || hits.length === 0) return;

  const widgets = hits.filter((hit) => hit.subtype === 'Widget');
  if (widgets.length > 0) removeFields(document, widgets);

  for (const hit of [...hits].sort((first, second) => second.index - first.index)) {
    // The form may already have taken it off the page with its field.
    const index = annotations.asArray().findIndex((value) => sameObject(value, hit.value));
    if (index >= 0) annotations.remove(index);
    deleteAnnotation(document, hit.value);
  }
}

/** Takes the fields the widgets belong to out of the form, with every widget. */
function removeFields(document: PDFDocument, widgets: readonly AnnotationHit[]): void {
  let form;
  try {
    form = document.getForm();
  } catch {
    return;
  }
  const doomed = new Set(widgets.map((widget) => widget.dict));
  for (const field of form.getFields()) {
    if (!field.acroField.getWidgets().some((widget) => doomed.has(widget.dict))) continue;
    try {
      form.removeField(field);
    } catch {
      // A widget pdf-lib cannot find a page for is still taken off this page
      // below; the field's own dictionary goes with the clean-up afterwards.
      form.acroForm.removeField(field.acroField);
    }
  }
}

function sameObject(first: PDFObject, second: PDFObject): boolean {
  if (first instanceof PDFRef && second instanceof PDFRef)
    return first.toString() === second.toString();
  return first === second;
}

function rectOf(document: PDFDocument, dict: PDFDict): Rect | null {
  const rect = document.context.lookupMaybe(dict.get(PDFName.of('Rect')), PDFArray);
  if (rect === undefined || rect.size() < 4) return null;
  const numbers = rect.asArray().map((value) => {
    const resolved = document.context.lookup(value);
    return resolved instanceof PDFNumber ? resolved.asNumber() : Number.NaN;
  });
  if (numbers.some((value) => !Number.isFinite(value))) return null;
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = numbers;
  return boundsOfPoints([
    { x: x1, y: y1 },
    { x: x2, y: y2 },
  ]);
}
