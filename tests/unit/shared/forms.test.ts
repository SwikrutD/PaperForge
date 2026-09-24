import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { PdfLibMutationEngine } from '../../../src/pdf/mutate/pdfLibEngine';
import { hasDocumentScript, needsAppearances, readFormFields } from '../../../src/pdf/forms/read';
import type { FormFieldModel } from '../../../src/shared/schemas/form';
import { readAnnotations } from '../../../src/pdf/mutate/annotations/read';
import { contentBytes } from '../../../src/pdf/content/pageContent';
import { DEFAULT_ANNOTATION_STYLE, type Annotation } from '../../../src/shared/schemas/annotation';
import { buildFormPdf } from '../../fixtures/forms';
import { pngPixel } from '../../fixtures/images';

/**
 * Reading a form and filling it in: what the fields are, what they hold, and
 * what survives being written to a file and read back.
 */

const engine = new PdfLibMutationEngine();

async function fieldsOf(bytes: Uint8Array): Promise<FormFieldModel[]> {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  return readFormFields(document);
}

/** The annotations a document carries, as the engine reads them. */
async function marksOf(bytes: Uint8Array): Promise<Annotation[]> {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  return readAnnotations(document).map((record) => record.annotation);
}

function byName(fields: readonly FormFieldModel[], name: string): FormFieldModel | undefined {
  return fields.find((field) => field.name === name);
}

describe('reading a form', () => {
  it('finds every field, with its kind and where it is drawn', async () => {
    const fields = await fieldsOf(await buildFormPdf({ pages: 2 }));

    expect(fields.map((field) => field.name)).toEqual([
      'person.name',
      'person.notes',
      'person.member',
      'person.plan',
      'person.country',
      'person.colours',
      'person.signedOn',
    ]);

    const name = byName(fields, 'person.name');
    expect(name?.type).toBe('text');
    expect(name?.value).toBe('Ada');
    expect(name?.maxLength).toBe(40);
    expect(name?.widgets).toHaveLength(1);
    expect(name?.widgets[0]?.page).toBe(1);
    expect(name?.widgets[0]?.rect.width).toBeCloseTo(201, 0);

    // A field on the second page says so.
    expect(byName(fields, 'person.signedOn')?.widgets[0]?.page).toBe(2);
  });

  it('says what a field will accept', async () => {
    const fields = await fieldsOf(
      await buildFormPdf({ requireName: true, tooltip: 'Your full name' }),
    );

    const name = byName(fields, 'person.name');
    expect(name?.required).toBe(true);
    expect(name?.tooltip).toBe('Your full name');
    expect(byName(fields, 'person.notes')?.multiline).toBe(true);
    expect(byName(fields, 'person.plan')?.options).toEqual(['basic', 'full']);
    expect(byName(fields, 'person.country')?.options).toEqual(['Ireland', 'Japan', 'Peru']);
  });

  it('gives a radio group one widget for each of its options', async () => {
    const plan = byName(await fieldsOf(await buildFormPdf()), 'person.plan');

    expect(plan?.widgets).toHaveLength(2);
    expect(plan?.widgets.map((widget) => widget.exportValue)).toEqual(['0', '1']);
  });

  it('notices a document with no script of its own', async () => {
    const document = await PDFDocument.load(await buildFormPdf(), { updateMetadata: false });
    expect(hasDocumentScript(document)).toBe(false);
    expect(needsAppearances(document)).toBe(false);
  });
});

describe('filling a form in', () => {
  it('writes what it was given, and reads it back the same', async () => {
    const result = await engine.apply(await buildFormPdf(), [
      {
        kind: 'setFieldValues',
        values: [
          { name: 'person.name', value: 'Grace' },
          { name: 'person.member', value: true },
          { name: 'person.plan', value: 'full' },
          { name: 'person.country', value: ['Japan'] },
          { name: 'person.colours', value: ['Red', 'Blue'] },
        ],
      },
    ]);

    const fields = await fieldsOf(result.bytes);
    expect(byName(fields, 'person.name')?.value).toBe('Grace');
    expect(byName(fields, 'person.member')?.value).toBe(true);
    expect(byName(fields, 'person.plan')?.value).toBe('full');
    expect(byName(fields, 'person.country')?.value).toEqual(['Japan']);
    expect(byName(fields, 'person.colours')?.value).toEqual(['Red', 'Blue']);
  });

  it('draws what was filled in, so a reader that draws nothing itself shows it', async () => {
    const result = await engine.apply(await buildFormPdf(), [
      { kind: 'setFieldValues', values: [{ name: 'person.name', value: 'Grace' }] },
    ]);

    const document = await PDFDocument.load(result.bytes, { updateMetadata: false });
    const widget = document.getForm().getTextField('person.name').acroField.getWidgets()[0];
    const appearance = widget?.getNormalAppearance();
    expect(appearance).toBeDefined();
    expect(needsAppearances(document)).toBe(false);
  });

  it('keeps a value no longer than the field allows', async () => {
    const result = await engine.apply(await buildFormPdf(), [
      { kind: 'setFieldValues', values: [{ name: 'person.name', value: 'x'.repeat(100) }] },
    ]);

    expect(String(byName(await fieldsOf(result.bytes), 'person.name')?.value)).toHaveLength(40);
  });

  it('leaves a read-only field alone', async () => {
    const result = await engine.apply(await buildFormPdf({ readOnlyName: true }), [
      { kind: 'setFieldValues', values: [{ name: 'person.name', value: 'Grace' }] },
    ]);

    expect(byName(await fieldsOf(result.bytes), 'person.name')?.value).toBe('Ada');
  });

  it('ignores an option a field does not offer', async () => {
    const result = await engine.apply(await buildFormPdf(), [
      {
        kind: 'setFieldValues',
        values: [
          { name: 'person.plan', value: 'platinum' },
          { name: 'person.country', value: ['Atlantis'] },
        ],
      },
    ]);

    const fields = await fieldsOf(result.bytes);
    expect(byName(fields, 'person.plan')?.value).toBe('');
    expect(byName(fields, 'person.country')?.value).toEqual([]);
  });

  it('clears a tick and a choice when asked', async () => {
    const filled = await engine.apply(await buildFormPdf(), [
      {
        kind: 'setFieldValues',
        values: [
          { name: 'person.member', value: true },
          { name: 'person.plan', value: 'basic' },
        ],
      },
    ]);
    const cleared = await engine.apply(filled.bytes, [
      {
        kind: 'setFieldValues',
        values: [
          { name: 'person.member', value: false },
          { name: 'person.plan', value: '' },
        ],
      },
    ]);

    const fields = await fieldsOf(cleared.bytes);
    expect(byName(fields, 'person.member')?.value).toBe(false);
    expect(byName(fields, 'person.plan')?.value).toBe('');
  });

  it('refuses a field that is no longer there', async () => {
    await expect(
      engine.apply(await buildFormPdf(), [
        { kind: 'setFieldValues', values: [{ name: 'person.missing', value: 'x' }] },
      ]),
    ).rejects.toThrow(/no longer in this document/i);
  });

  it('fills several fields as one change', async () => {
    const result = await engine.apply(await buildFormPdf(), [
      {
        kind: 'setFieldValues',
        values: [
          { name: 'person.name', value: 'Grace' },
          { name: 'person.notes', value: 'Two lines\nof notes' },
        ],
      },
    ]);

    // One operation, one revision: undo puts both back.
    const fields = await fieldsOf(result.bytes);
    expect(byName(fields, 'person.notes')?.value).toBe('Two lines\nof notes');
  });
});

describe('a signature placed as a mark', () => {
  it('keeps its picture when it is moved', async () => {
    const staged = new Map([
      [
        'sig',
        {
          kind: 'image' as const,
          bytes: pngPixel(40, 20),
          format: 'png' as const,
          width: 40,
          height: 20,
        },
      ],
    ]);

    const placed = await engine.apply(
      await buildFormPdf(),
      [
        {
          kind: 'addAnnotations',
          annotations: [
            {
              pageNumber: 1,
              geometry: { kind: 'imageStamp', rect: { x: 60, y: 60, width: 120, height: 60 } },
              style: DEFAULT_ANNOTATION_STYLE,
              contents: '',
              author: 'Grace',
              subject: '',
              imageToken: 'sig',
            },
          ],
        },
      ],
      staged,
    );

    const before = await marksOf(placed.bytes);
    const mark = before[0];
    expect(mark).toBeDefined();

    const moved = await engine.apply(placed.bytes, [
      {
        kind: 'updateAnnotations',
        updates: [
          {
            id: mark?.id ?? '',
            patch: {
              geometry: { kind: 'stamp', rect: { x: 200, y: 200, width: 120, height: 60 } },
            },
          },
        ],
      },
    ]);

    // The picture is still what the mark draws: moving it must not turn a
    // signature into an empty box.
    const document = await PDFDocument.load(moved.bytes, { updateMetadata: false });
    const text = new TextDecoder('latin1').decode(moved.bytes);
    expect(text).toContain('/Image');
    expect(document.getPage(0).node.Annots()?.size()).toBeGreaterThan(0);

    const after = await marksOf(moved.bytes);
    expect(after[0]?.geometry.kind).toBe('stamp');
    expect(Math.round((after[0]?.geometry as { rect: { x: number } }).rect.x)).toBe(200);
  });
});

describe('flattening', () => {
  it('draws what a field holds onto the page and takes the field away', async () => {
    const filled = await engine.apply(await buildFormPdf(), [
      { kind: 'setFieldValues', values: [{ name: 'person.name', value: 'Grace Hopper' }] },
    ]);

    const flattened = await engine.apply(filled.bytes, [
      { kind: 'flattenFields', names: ['person.name'] },
    ]);

    const fields = await fieldsOf(flattened.bytes);
    expect(byName(fields, 'person.name')).toBeUndefined();
    // The other fields are still fields.
    expect(byName(fields, 'person.notes')).toBeDefined();

    // What it held is now drawn by the page itself.
    const document = await PDFDocument.load(flattened.bytes, { updateMetadata: false });
    const content = new TextDecoder('latin1').decode(contentBytes(document, document.getPage(0)));
    expect(content).toMatch(/\/PFFlat[\w-]+ Do/);
  });

  it('flattens the whole form when it is not told which fields', async () => {
    const flattened = await engine.apply(await buildFormPdf(), [
      { kind: 'flattenFields', names: null },
    ]);

    expect(await fieldsOf(flattened.bytes)).toHaveLength(0);
  });

  it('turns a placed mark into part of the page', async () => {
    const staged = new Map([
      [
        'sig',
        {
          kind: 'image' as const,
          bytes: pngPixel(40, 20),
          format: 'png' as const,
          width: 40,
          height: 20,
        },
      ],
    ]);

    const placed = await engine.apply(
      await buildFormPdf(),
      [
        {
          kind: 'addAnnotations',
          annotations: [
            {
              pageNumber: 1,
              geometry: { kind: 'imageStamp', rect: { x: 60, y: 60, width: 120, height: 60 } },
              style: DEFAULT_ANNOTATION_STYLE,
              contents: '',
              author: 'Grace',
              subject: '',
              imageToken: 'sig',
            },
          ],
        },
      ],
      staged,
    );

    const flattened = await engine.apply(placed.bytes, [{ kind: 'flattenAnnotations', ids: null }]);

    expect(await marksOf(flattened.bytes)).toHaveLength(0);
    const document = await PDFDocument.load(flattened.bytes, { updateMetadata: false });
    const content = new TextDecoder('latin1').decode(contentBytes(document, document.getPage(0)));
    expect(content).toMatch(/\/PFFlat[\w-]+ Do/);
  });
});
