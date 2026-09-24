import {
  PDFButton,
  PDFCheckBox,
  PDFDict,
  PDFDropdown,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFOptionList,
  PDFRadioGroup,
  PDFSignature,
  PDFString,
  PDFTextField,
  type PDFDocument,
  type PDFField,
  type PDFWidgetAnnotation,
} from 'pdf-lib';
import type { FormFieldModel, FormFieldType, FormValue, FormWidget } from '@shared/schemas/form';
import { readRule } from './rules';

/**
 * Reading the form a document carries.
 *
 * Every field is reported with what it holds, where it is drawn and what it
 * will accept. Actions are noticed but never followed: a form that calculates
 * with JavaScript is marked as such so the reader can be told, and PaperForge
 * does its own arithmetic instead.
 */

export function readFormFields(document: PDFDocument): FormFieldModel[] {
  const form = document.getForm();
  const pages = document.getPages();
  const pageOf = new Map(pages.map((page, index) => [page.ref, index + 1]));

  return form.getFields().map((field) => describe(document, field, pageOf));
}

/** True when the document itself carries JavaScript, which is never run. */
export function hasDocumentScript(document: PDFDocument): boolean {
  const names = document.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
  if (names?.has(PDFName.of('JavaScript')) === true) return true;

  const actions = document.catalog.lookupMaybe(PDFName.of('AA'), PDFDict);
  return actions !== undefined && actions.keys().length > 0;
}

/** True when the form asks readers to draw every field's appearance again. */
export function needsAppearances(document: PDFDocument): boolean {
  const acroForm = document.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
  const flag = acroForm?.lookup(PDFName.of('NeedAppearances'));
  return flag?.toString() === 'true';
}

function describe(
  document: PDFDocument,
  field: PDFField,
  pageOf: ReadonlyMap<unknown, number>,
): FormFieldModel {
  const acro = field.acroField;
  const type = typeOf(field);

  return {
    name: field.getName(),
    type,
    widgets: acro.getWidgets().map((widget) => widgetOf(widget, pageOf)),
    value: valueOf(field),
    options: optionsOf(field),
    required: field.isRequired(),
    readOnly: field.isReadOnly(),
    multiline: field instanceof PDFTextField && field.isMultiline(),
    password: field instanceof PDFTextField && field.isPassword(),
    maxLength: field instanceof PDFTextField ? (field.getMaxLength() ?? null) : null,
    alignment: alignmentOf(field),
    fontSize: fontSizeOf(document, acro.dict),
    tooltip: textOf(document, acro.dict, 'TU'),
    rule: readRule(document, field),
    hasScript:
      carriesAction(document, acro.dict) ||
      acro.getWidgets().some((widget) => carriesAction(document, widget.dict)),
  };
}

function typeOf(field: PDFField): FormFieldType {
  if (field instanceof PDFTextField) return 'text';
  if (field instanceof PDFCheckBox) return 'checkbox';
  if (field instanceof PDFRadioGroup) return 'radio';
  if (field instanceof PDFDropdown) return 'dropdown';
  if (field instanceof PDFOptionList) return 'optionList';
  if (field instanceof PDFSignature) return 'signature';
  if (field instanceof PDFButton) return 'button';
  // A field of a kind pdf-lib does not model is shown, and left alone.
  return 'button';
}

function widgetOf(widget: PDFWidgetAnnotation, pageOf: ReadonlyMap<unknown, number>): FormWidget {
  const rect = widget.getRectangle();
  return {
    page: pageOf.get(widget.P()) ?? 1,
    rect: {
      x: rect.x,
      y: rect.y,
      width: Math.max(0, rect.width),
      height: Math.max(0, rect.height),
    },
    exportValue: widget.getOnValue()?.decodeText() ?? null,
  };
}

export function valueOf(field: PDFField): FormValue | null {
  if (field instanceof PDFTextField) return field.getText() ?? '';
  if (field instanceof PDFCheckBox) return field.isChecked();
  if (field instanceof PDFRadioGroup) return field.getSelected() ?? '';
  if (field instanceof PDFDropdown) return field.getSelected();
  if (field instanceof PDFOptionList) return field.getSelected();
  return null;
}

function optionsOf(field: PDFField): string[] | null {
  if (field instanceof PDFRadioGroup) return field.getOptions();
  if (field instanceof PDFDropdown) return field.getOptions();
  if (field instanceof PDFOptionList) return field.getOptions();
  return null;
}

function alignmentOf(field: PDFField): 'left' | 'center' | 'right' | null {
  if (!(field instanceof PDFTextField)) return null;
  // Quadding, as the PDF specification numbers it: 0 left, 1 centred, 2 right.
  const quadding = Number(field.getAlignment());
  return quadding === 1 ? 'center' : quadding === 2 ? 'right' : 'left';
}

/** The size in the field's default appearance string, when it names one. */
function fontSizeOf(document: PDFDocument, dict: PDFDict): number | null {
  const appearance = textOf(document, dict, 'DA');
  if (appearance === null) return null;

  const match = /(\d+(?:\.\d+)?)\s+Tf/.exec(appearance);
  const size = match === null ? Number.NaN : Number(match[1]);
  // A size of zero means "fit the box", which is a fact worth keeping.
  return Number.isFinite(size) ? size : null;
}

function textOf(document: PDFDocument, dict: PDFDict, key: string): string | null {
  const value = document.context.lookup(dict.get(PDFName.of(key)));
  if (value instanceof PDFString || value instanceof PDFHexString) return value.decodeText();
  if (value instanceof PDFNumber) return value.toString();
  return null;
}

/**
 * Whether a dictionary carries an action.
 *
 * PaperForge does not run them — not the JavaScript a form calculates with,
 * and not a launch action. Noticing one is what lets the reader be told.
 */
function carriesAction(document: PDFDocument, dict: PDFDict): boolean {
  for (const key of ['A', 'AA']) {
    const value = document.context.lookup(dict.get(PDFName.of(key)));
    if (value instanceof PDFDict && value.keys().length > 0) return true;
  }
  return false;
}
