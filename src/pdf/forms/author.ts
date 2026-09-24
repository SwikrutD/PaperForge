import {
  PDFCheckBox,
  PDFDropdown,
  PDFHexString,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFString,
  PDFTextField,
  type PDFDocument,
  type PDFField,
  type PDFPage,
} from 'pdf-lib';
import { AppError } from '@shared/errors/appError';
import type { EditOperation } from '@shared/schemas/edit';
import type { FormFieldProperties, FormFieldType, FormValue } from '@shared/schemas/form';
import { setValue } from './write';
import { appearanceFont, refreshAppearances } from './write';

/**
 * Making a form: adding fields to a page, changing what they are, and taking
 * them away again.
 *
 * PaperForge writes ordinary AcroForm fields — the kind every reader knows —
 * and no document JavaScript. A calculation is worked out by PaperForge when
 * the form is filled in, and written as a value, rather than left as a script
 * for some other reader to run.
 */

export async function applyAuthoringOperation(
  document: PDFDocument,
  operation: EditOperation,
): Promise<boolean> {
  if (
    operation.kind !== 'addFormField' &&
    operation.kind !== 'updateFormField' &&
    operation.kind !== 'deleteFormField'
  ) {
    return false;
  }

  const form = document.getForm();

  if (operation.kind === 'deleteFormField') {
    const field = form.getFieldMaybe(operation.name);
    if (field === undefined) return true;
    form.removeField(field);
    return true;
  }

  if (operation.kind === 'addFormField') {
    const pageIndex = operation.page - 1;
    if (pageIndex < 0 || pageIndex >= document.getPageCount()) {
      throw new AppError('internal/unexpected', {
        message: 'That page is not in this document any more.',
        details: `page ${String(operation.page)}`,
      });
    }
    if (form.getFieldMaybe(operation.name) !== undefined) {
      throw new AppError('internal/unexpected', {
        message: 'A field of that name is already in this document.',
        details: operation.name,
      });
    }

    await createField(document, document.getPage(pageIndex), operation.name, operation.fieldType, {
      rect: operation.rect,
      options: operation.options,
      properties: operation.properties,
    });
    await refreshAppearances(document);
    return true;
  }

  const field = form.getFieldMaybe(operation.name);
  if (field === undefined) {
    throw new AppError('pdf/malformed-content', {
      message: 'That field is no longer in this document.',
      details: operation.name,
    });
  }

  applyProperties(field, operation.properties);
  if (operation.options !== null) setOptions(field, operation.options);
  if (operation.rect !== null) moveField(field, operation.rect);

  if (operation.newName !== null && operation.newName !== operation.name) {
    await renameField(document, field, operation.newName, operation.properties);
    return true;
  }

  // Changing what a field is means its appearance has to be drawn again.
  field.defaultUpdateAppearances(await appearanceFont(document));
  await refreshAppearances(document);
  return true;
}

interface CreateOptions {
  rect: { x: number; y: number; width: number; height: number };
  options: readonly string[] | null;
  properties: FormFieldProperties;
}

async function createField(
  document: PDFDocument,
  page: PDFPage,
  name: string,
  type: FormFieldType,
  options: CreateOptions,
): Promise<void> {
  const form = document.getForm();
  const font = await appearanceFont(document);
  const box = { ...options.rect, font };

  switch (type) {
    case 'text': {
      const field = form.createTextField(name);
      if (options.properties.multiline) field.enableMultiline();
      if (options.properties.password) field.enablePassword();
      if (options.properties.maxLength !== null) field.setMaxLength(options.properties.maxLength);
      field.addToPage(page, box);
      break;
    }
    case 'checkbox': {
      const field = form.createCheckBox(name);
      field.addToPage(page, box);
      break;
    }
    case 'radio': {
      const field = form.createRadioGroup(name);
      const choices = options.options ?? ['Yes', 'No'];
      // The options are laid out down the box they were drawn in, one per row.
      const height = options.rect.height / Math.max(1, choices.length);
      for (const [index, choice] of choices.entries()) {
        field.addOptionToPage(choice, page, {
          x: options.rect.x,
          y: options.rect.y + options.rect.height - height * (index + 1),
          width: Math.min(height, options.rect.width),
          height,
        });
      }
      break;
    }
    case 'dropdown': {
      const field = form.createDropdown(name);
      field.setOptions([...(options.options ?? [])]);
      field.addToPage(page, box);
      break;
    }
    case 'optionList': {
      const field = form.createOptionList(name);
      field.setOptions([...(options.options ?? [])]);
      field.addToPage(page, box);
      break;
    }
    case 'button': {
      const field = form.createButton(name);
      field.addToPage(options.properties.label ?? name, page, box);
      break;
    }
    case 'signature': {
      // pdf-lib does not author signature fields, and PaperForge does not sign
      // with certificates: a place for a signature is a read-only text field,
      // which every reader shows and none pretends to validate.
      const field = form.createTextField(name);
      field.addToPage(page, box);
      break;
    }
  }

  const created = form.getFieldMaybe(name);
  if (created !== undefined) {
    applyProperties(created, {
      ...options.properties,
      // Nobody types into a place for a signature: the mark goes on top of it.
      readOnly: type === 'signature' ? true : options.properties.readOnly,
    });
  }
}

/** The things a field's properties dictate, whatever kind it is. */
function applyProperties(field: PDFField, properties: FormFieldProperties): void {
  if (properties.required) field.enableRequired();
  else field.disableRequired();

  if (properties.readOnly) field.enableReadOnly();
  else field.disableReadOnly();

  setText(field, 'TU', properties.tooltip);

  if (field instanceof PDFTextField) {
    if (properties.multiline) field.enableMultiline();
    else field.disableMultiline();
    if (properties.password) field.enablePassword();
    else field.disablePassword();

    if (properties.maxLength === null) field.removeMaxLength();
    else field.setMaxLength(properties.maxLength);

    field.setAlignment(
      properties.alignment === 'center' ? 1 : properties.alignment === 'right' ? 2 : 0,
    );
    if (properties.fontSize !== null) field.setFontSize(properties.fontSize);
  }

  if (properties.defaultValue !== null) setValue(field, properties.defaultValue);
}

function setOptions(field: PDFField, options: readonly string[]): void {
  if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
    field.setOptions([...options]);
  }
  // A radio group's options are its widgets, which is a different change: the
  // field is removed and made again rather than half-rewritten.
}

/** Moves and resizes every widget of a field into the given box. */
function moveField(
  field: PDFField,
  rect: { x: number; y: number; width: number; height: number },
): void {
  const widgets = field.acroField.getWidgets();
  const height = rect.height / Math.max(1, widgets.length);

  for (const [index, widget] of widgets.entries()) {
    const box =
      widgets.length === 1
        ? rect
        : {
            x: rect.x,
            y: rect.y + rect.height - height * (index + 1),
            width: Math.min(height, rect.width),
            height,
          };
    widget.setRectangle(box);
  }
}

/**
 * Renaming a field means making it again under the new name.
 *
 * A field's name is where it sits in the form's tree, not a label on it, so
 * writing a new `/T` would move it somewhere it does not belong. PaperForge
 * reads what the field is, puts an identical one there under the new name,
 * and takes the old one away — and refuses outright when the field carries an
 * action it would have to drop on the floor.
 */
async function renameField(
  document: PDFDocument,
  field: PDFField,
  name: string,
  properties: FormFieldProperties,
): Promise<void> {
  const form = document.getForm();
  if (form.getFieldMaybe(name) !== undefined) {
    throw new AppError('internal/unexpected', {
      message: 'A field of that name is already in this document.',
      details: name,
    });
  }

  const dict = field.acroField.dict;
  if (dict.has(PDFName.of('A')) || dict.has(PDFName.of('AA'))) {
    throw new AppError('internal/unexpected', {
      message: 'That field carries an action, so PaperForge will not rename it.',
      details:
        'Renaming means making the field again, and PaperForge does not copy actions it cannot read.',
    });
  }

  const widgets = field.acroField.getWidgets();
  const first = widgets[0];
  const pages = document.getPages();
  const page = pages.find((candidate) => candidate.ref === first?.P());
  if (first === undefined || page === undefined) {
    throw new AppError('internal/unexpected', {
      message: 'That field is not drawn anywhere, so PaperForge cannot rename it.',
    });
  }

  const rectangle = first.getRectangle();
  const type = typeOf(field);
  const options = optionsOf(field);
  const value = currentValue(field);

  form.removeField(field);
  await createField(document, page, name, type, {
    rect: rectangle,
    options,
    properties: { ...properties, defaultValue: value },
  });
  await refreshAppearances(document);
}

function typeOf(field: PDFField): FormFieldType {
  if (field instanceof PDFCheckBox) return 'checkbox';
  if (field instanceof PDFRadioGroup) return 'radio';
  if (field instanceof PDFDropdown) return 'dropdown';
  if (field instanceof PDFOptionList) return 'optionList';
  return 'text';
}

function optionsOf(field: PDFField): string[] | null {
  if (field instanceof PDFRadioGroup) return field.getOptions();
  if (field instanceof PDFDropdown) return field.getOptions();
  if (field instanceof PDFOptionList) return field.getOptions();
  return null;
}

function currentValue(field: PDFField): FormValue | null {
  if (field instanceof PDFTextField) return field.getText() ?? null;
  if (field instanceof PDFCheckBox) return field.isChecked();
  if (field instanceof PDFRadioGroup) return field.getSelected() ?? null;
  if (field instanceof PDFDropdown || field instanceof PDFOptionList) return field.getSelected();
  return null;
}

function setText(field: PDFField, key: string, value: string | null): void {
  const dict = field.acroField.dict;
  if (value === null || value === '') dict.delete(PDFName.of(key));
  else dict.set(PDFName.of(key), textValue(value));
}

/** Latin-1 where it fits, UTF-16 where the text needs it. */
function textValue(value: string): PDFString | PDFHexString {
  // eslint-disable-next-line no-control-regex
  return /^[\u0000-ÿ]*$/.test(value) ? PDFString.of(value) : PDFHexString.fromText(value);
}

/** True when a field is one whose value the reader types rather than picks. */
export function isTypedField(field: PDFField): boolean {
  return (
    field instanceof PDFTextField ||
    field instanceof PDFCheckBox ||
    field instanceof PDFRadioGroup ||
    field instanceof PDFDropdown ||
    field instanceof PDFOptionList
  );
}
