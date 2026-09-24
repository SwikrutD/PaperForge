import {
  PDFCheckBox,
  PDFDropdown,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
  StandardFonts,
  type PDFDocument,
  type PDFField,
  type PDFFont,
} from 'pdf-lib';
import { AppError } from '@shared/errors/appError';
import type { EditOperation } from '@shared/schemas/edit';
import type { FormValue } from '@shared/schemas/form';

/**
 * Filling in a form.
 *
 * A value is written through the field's own type, and the appearance of the
 * fields that changed is drawn again — a reader that does not generate
 * appearances itself still sees what was filled in.
 *
 * Nothing here runs the document's JavaScript. A form that calculates with a
 * script keeps the script; PaperForge writes only the values it was given,
 * and its own calculations are worked out before they get here.
 */

export async function applyFormOperation(
  document: PDFDocument,
  operation: EditOperation,
): Promise<boolean> {
  if (operation.kind !== 'setFieldValues') return false;

  const form = document.getForm();
  for (const change of operation.values) {
    const field = form.getFieldMaybe(change.name);
    if (field === undefined) {
      throw new AppError('pdf/malformed-content', {
        message: 'That field is no longer in this document.',
        details: change.name,
      });
    }
    if (field.isReadOnly()) continue;
    setValue(field, change.value);
  }

  await refreshAppearances(document);
  return true;
}

/** Writes one value through whatever kind of field it belongs to. */
export function setValue(field: PDFField, value: FormValue | null): void {
  if (field instanceof PDFTextField) {
    const text = value === null || value === false ? '' : String(value);
    const limit = field.getMaxLength();
    field.setText(limit === undefined ? text : text.slice(0, limit));
    return;
  }

  if (field instanceof PDFCheckBox) {
    if (value === true || value === 'true' || value === 'on') field.check();
    else field.uncheck();
    return;
  }

  if (field instanceof PDFRadioGroup) {
    const chosen = typeof value === 'string' ? value : null;
    if (chosen === null || chosen === '') field.clear();
    else if (field.getOptions().includes(chosen)) field.select(chosen);
    return;
  }

  if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
    const chosen = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
    const offered = field.getOptions();
    const known = chosen.filter((option) => offered.includes(option));
    if (known.length === 0) field.clear();
    else field.select(known.length === 1 ? (known[0] as string) : known);
    return;
  }

  // A button or a signature placeholder holds nothing to write.
}

/**
 * Draws the appearance of every field that changed.
 *
 * Only fields pdf-lib has marked dirty are redrawn, so a field with an
 * appearance the document itself authored is left exactly as it is.
 */
export async function refreshAppearances(document: PDFDocument): Promise<void> {
  const form = document.getForm();
  const font = await appearanceFont(document);
  form.updateFieldAppearances(font);

  // The form no longer asks readers to draw the fields themselves, because
  // PaperForge has just drawn the ones that changed.
  form.acroForm.dict.delete(PDFName.of('NeedAppearances'));
}

const FONTS = new WeakMap<PDFDocument, PDFFont>();

/** Helvetica, embedded once per document, for drawing what was filled in. */
export async function appearanceFont(document: PDFDocument): Promise<PDFFont> {
  const existing = FONTS.get(document);
  if (existing !== undefined) return existing;

  const font = await document.embedFont(StandardFonts.Helvetica);
  FONTS.set(document, font);
  return font;
}
