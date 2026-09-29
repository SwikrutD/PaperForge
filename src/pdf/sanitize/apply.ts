import { PDFArray, PDFDict, PDFName, PDFNumber, PDFStream, type PDFDocument } from 'pdf-lib';
import type { EditOperation } from '@shared/schemas/edit';
import type { SanitizeCategory } from '@shared/schemas/sanitize';
import { removeAllAttachments } from '../attachments/write';
import { resourcesOf } from '../content/pageContent';
import { removeInfoEntries, removeXmp } from '../metadata/write';
import { collectActions, javaScriptNameEntries, namesOwner } from './actions';
import { deleteAction, deleteAnnotation, deleteReferenced } from './prune';

/**
 * Removing hidden information.
 *
 * Only the categories the reader chose are touched, and an action is deleted
 * without ever being performed. What is removed here is removed from the
 * document object graph; the full rewrite that every PaperForge save performs
 * is what stops the old bytes travelling with the new file.
 */

const FLAG_HIDDEN = 1 << 1;
const FLAG_NO_VIEW = 1 << 5;

export function applySanitizeOperation(document: PDFDocument, operation: EditOperation): boolean {
  if (operation.kind !== 'sanitize') return false;
  sanitize(document, operation.categories);
  return true;
}

export function sanitize(document: PDFDocument, categories: readonly SanitizeCategory[]): void {
  const chosen = new Set(categories);

  if (chosen.has('metadata')) removeInfoEntries(document);
  if (chosen.has('xmpMetadata')) removeXmp(document);
  if (chosen.has('attachments')) removeAllAttachments(document);
  if (chosen.has('documentJavaScript')) removeActions(document, 'javascript');
  if (chosen.has('launchActions')) removeActions(document, 'reachingOut');
  if (chosen.has('hiddenAnnotations')) removeHiddenAnnotations(document);
  if (chosen.has('formData')) clearFormValues(document);
  if (chosen.has('thumbnails')) removeThumbnails(document);
  if (chosen.has('hiddenLayers')) removeHiddenLayers(document);
  if (chosen.has('alternateImages')) removeAlternateImages(document);
}

/** Deletes every action of a kind, and the JavaScript name tree with them. */
function removeActions(document: PDFDocument, kind: 'javascript' | 'reachingOut'): void {
  const sites = collectActions(document).filter((site) => site.kind === kind);

  for (const site of sites) {
    // The reference goes and so does what it pointed at, script and all. It is
    // read to find the /Next chain; it is never performed.
    deleteAction(document, site.owner.get(site.key));
    site.owner.delete(site.key);
  }

  if (kind !== 'javascript') return;
  const names = namesOwner(document);
  if (names === undefined) return;

  const tree = names.get(PDFName.of('JavaScript'));
  for (const entry of javaScriptNameEntries(document)) deleteAction(document, entry.value);
  deleteReferenced(document, tree);
  names.delete(PDFName.of('JavaScript'));
}

function removeHiddenAnnotations(document: PDFDocument): void {
  for (const page of document.getPages()) {
    const annotations = document.context.lookupMaybe(page.node.get(PDFName.of('Annots')), PDFArray);
    if (annotations === undefined) continue;

    // Highest index first, so the ones still to check keep their positions.
    for (let index = annotations.size() - 1; index >= 0; index -= 1) {
      const annotation = document.context.lookupMaybe(annotations.get(index), PDFDict);
      const flags = annotation?.lookup(PDFName.of('F'));
      if (!(flags instanceof PDFNumber)) continue;
      const value = flags.asNumber();
      if ((value & FLAG_HIDDEN) === 0 && (value & FLAG_NO_VIEW) === 0) continue;

      deleteAnnotation(document, annotations.get(index));
      annotations.remove(index);
    }
  }
}

/**
 * Empties the form, leaving the fields themselves.
 *
 * A form without its values is still a form. Removing the fields as well is
 * what flattening does, and that is a different choice made in a different
 * place.
 */
function clearFormValues(document: PDFDocument): void {
  let form;
  try {
    form = document.getForm();
  } catch {
    return;
  }

  for (const field of form.getFields()) {
    const dict = field.acroField.dict;
    dict.delete(PDFName.of('V'));
    dict.delete(PDFName.of('DV'));

    // A widget keeps its own appearance state, which still shows a tick.
    for (const widget of field.acroField.getWidgets()) {
      widget.dict.set(PDFName.of('AS'), PDFName.of('Off'));
    }
  }

  try {
    form.updateFieldAppearances();
  } catch {
    // A form PaperForge cannot draw keeps the appearances it has; the values
    // are gone either way.
  }
}

function removeThumbnails(document: PDFDocument): void {
  for (const page of document.getPages()) {
    deleteReferenced(document, page.node.get(PDFName.of('Thumb')));
    page.node.delete(PDFName.of('Thumb'));
  }
}

/**
 * Takes out the optional content groups the default configuration switches
 * off, along with the content that belongs to them.
 *
 * The group's own dictionary is removed from the catalogue's listing. The
 * marked content that referenced it stays on the page but is no longer
 * optional, so nothing a reader could reveal is left behind.
 */
function removeHiddenLayers(document: PDFDocument): void {
  const properties = document.context.lookupMaybe(
    document.catalog.get(PDFName.of('OCProperties')),
    PDFDict,
  );
  if (properties === undefined) return;

  const configuration = document.context.lookupMaybe(properties.get(PDFName.of('D')), PDFDict);
  const off = document.context.lookupMaybe(configuration?.get(PDFName.of('OFF')), PDFArray);
  if (off === undefined || configuration === undefined) return;

  const hidden = new Set<string>();
  for (let index = 0; index < off.size(); index += 1) {
    const ref = off.get(index);
    hidden.add(ref.toString());
  }

  for (const key of ['OCGs', 'Order', 'ON', 'AS'] as const) {
    const list = document.context.lookupMaybe(
      (key === 'OCGs' ? properties : configuration).get(PDFName.of(key)),
      PDFArray,
    );
    if (list === undefined) continue;
    for (let index = list.size() - 1; index >= 0; index -= 1) {
      if (hidden.has(list.get(index).toString())) list.remove(index);
    }
  }

  configuration.delete(PDFName.of('OFF'));
}

function removeAlternateImages(document: PDFDocument): void {
  for (const page of document.getPages()) {
    const xobjects = document.context.lookupMaybe(
      resourcesOf(document, page)?.get(PDFName.of('XObject')),
      PDFDict,
    );
    if (xobjects === undefined) continue;

    for (const [, value] of xobjects.entries()) {
      const stream = document.context.lookupMaybe(value, PDFStream);
      stream?.dict.delete(PDFName.of('Alternates'));
    }
  }
}
