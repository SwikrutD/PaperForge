import { z } from 'zod';

/**
 * The form a document carries, as the editor sees it.
 *
 * A field is named, typed and drawn somewhere — sometimes in several places,
 * which is what a widget is. Everything here is read from the document's own
 * AcroForm; PaperForge never runs the JavaScript a form may carry, and says
 * plainly when it finds some.
 */

export const formFieldTypeSchema = z.enum([
  'text',
  'checkbox',
  'radio',
  'dropdown',
  'optionList',
  'button',
  'signature',
]);
export type FormFieldType = z.infer<typeof formFieldTypeSchema>;

const measurement = z.number().finite().min(-1_000_000).max(1_000_000);

/** One place a field is drawn. A radio group has one per option. */
export const formWidgetSchema = z.strictObject({
  page: z.number().int().min(1),
  rect: z.strictObject({
    x: measurement,
    y: measurement,
    width: z.number().finite().min(0).max(1_000_000),
    height: z.number().finite().min(0).max(1_000_000),
  }),
  /** What checking this widget sets the field to, for checkboxes and radios. */
  exportValue: z.string().max(200).nullable(),
});
export type FormWidget = z.infer<typeof formWidgetSchema>;

/**
 * What a field holds: text, a tick, or one or more chosen options.
 */
export const formValueSchema = z.union([z.string().max(20_000), z.array(z.string()), z.boolean()]);
export type FormValue = z.infer<typeof formValueSchema>;

export const formFieldSchema = z.strictObject({
  /** The fully qualified name, which is how the field is addressed. */
  name: z.string().min(1).max(500),
  type: formFieldTypeSchema,
  widgets: z.array(formWidgetSchema),
  value: formValueSchema.nullable(),
  /** The choices a dropdown, list or radio group offers. */
  options: z.array(z.string()).nullable(),
  required: z.boolean(),
  readOnly: z.boolean(),
  multiline: z.boolean(),
  /** A field that shows dots instead of what is typed. */
  password: z.boolean(),
  maxLength: z.number().int().min(0).max(100_000).nullable(),
  alignment: z.enum(['left', 'center', 'right']).nullable(),
  fontSize: z.number().finite().min(0).max(1000).nullable(),
  /** `/TU`, which readers show as a tooltip. */
  tooltip: z.string().max(1000).nullable(),
  /** True when the field or its widgets carry an action PaperForge will not run. */
  hasScript: z.boolean(),
});
export type FormFieldModel = z.infer<typeof formFieldSchema>;

export const formModelSchema = z.strictObject({
  /** The revision the form was read from, so a stale model can be spotted. */
  revision: z.number().int().min(0),
  fields: z.array(formFieldSchema),
  /** True when the document carries JavaScript of its own. */
  hasDocumentScript: z.boolean(),
  /** True when the form asks readers to regenerate every appearance. */
  needsAppearances: z.boolean(),
});
export type FormModel = z.infer<typeof formModelSchema>;

/** What a field is and what it will accept, when one is being authored. */
export const formFieldPropertiesSchema = z.strictObject({
  tooltip: z.string().max(1000).nullable(),
  required: z.boolean(),
  readOnly: z.boolean(),
  multiline: z.boolean(),
  password: z.boolean(),
  maxLength: z.number().int().min(1).max(100_000).nullable(),
  alignment: z.enum(['left', 'center', 'right']),
  fontSize: z.number().min(0).max(1000).nullable(),
  /** What the field holds to begin with. */
  defaultValue: formValueSchema.nullable(),
  /** The words on a push button. */
  label: z.string().max(200).nullable(),
});
export type FormFieldProperties = z.infer<typeof formFieldPropertiesSchema>;

export const DEFAULT_FIELD_PROPERTIES: FormFieldProperties = {
  tooltip: null,
  required: false,
  readOnly: false,
  multiline: false,
  password: false,
  maxLength: null,
  alignment: 'left',
  fontSize: null,
  defaultValue: null,
  label: null,
};

/** One field's new value, as the window sends it. */
export const formValueChangeSchema = z.strictObject({
  name: z.string().min(1).max(500),
  value: formValueSchema.nullable(),
});
export type FormValueChange = z.infer<typeof formValueChangeSchema>;
