import { PDFDocument, PDFName, PDFString, StandardFonts } from 'pdf-lib';

/**
 * Documents with a form on them, built field by field.
 *
 * Nothing here is copied from anywhere: pdf-lib writes the AcroForm, so the
 * tests own exactly the form they assert about.
 */

export interface FormFixtureOptions {
  /** A second page, so a test can check which page a field is drawn on. */
  pages?: number;
  /** Marks the name field as one that must be filled in. */
  requireName?: boolean;
  /** Marks the name field read-only, which filling must respect. */
  readOnlyName?: boolean;
  /** Gives the name field a tooltip, which the panel shows. */
  tooltip?: string;
}

export async function buildFormPdf(options: FormFixtureOptions = {}): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const pages = Array.from({ length: options.pages ?? 1 }, () => document.addPage([400, 400]));
  const first = pages[0]!;
  const form = document.getForm();

  const name = form.createTextField('person.name');
  name.setText('Ada');
  name.setMaxLength(40);
  name.addToPage(first, { x: 40, y: 320, width: 200, height: 24 });
  if (options.requireName === true) name.enableRequired();
  if (options.readOnlyName === true) name.enableReadOnly();
  if (options.tooltip !== undefined) {
    name.acroField.dict.set(PDFName.of('TU'), PDFString.of(options.tooltip));
  }

  const notes = form.createTextField('person.notes');
  notes.enableMultiline();
  notes.addToPage(first, { x: 40, y: 220, width: 200, height: 80 });

  const member = form.createCheckBox('person.member');
  member.addToPage(first, { x: 40, y: 190, width: 16, height: 16 });

  const plan = form.createRadioGroup('person.plan');
  plan.addOptionToPage('basic', first, { x: 40, y: 160, width: 16, height: 16 });
  plan.addOptionToPage('full', first, { x: 100, y: 160, width: 16, height: 16 });

  const country = form.createDropdown('person.country');
  country.setOptions(['Ireland', 'Japan', 'Peru']);
  country.addToPage(first, { x: 40, y: 120, width: 160, height: 22 });

  const colours = form.createOptionList('person.colours');
  colours.setOptions(['Red', 'Green', 'Blue']);
  colours.addToPage(first, { x: 40, y: 40, width: 160, height: 60 });

  const last = pages[pages.length - 1]!;
  if (last !== first) {
    const signed = form.createTextField('person.signedOn');
    signed.addToPage(last, { x: 40, y: 320, width: 160, height: 22 });
  }

  const font = await document.embedFont(StandardFonts.Helvetica);
  form.updateFieldAppearances(font);
  return document.save();
}
