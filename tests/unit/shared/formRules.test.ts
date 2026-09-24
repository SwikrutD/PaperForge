import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { PdfLibMutationEngine } from '../../../src/pdf/mutate/pdfLibEngine';
import { hasDocumentScript, readFormFields } from '../../../src/pdf/forms/read';
import { calculate, readDate, toNumber, validate } from '../../../src/pdf/forms/rules';
import {
  DEFAULT_FIELD_PROPERTIES,
  NO_FIELD_RULE,
  type FormFieldRule,
} from '../../../src/shared/schemas/form';
import { buildFormPdf } from '../../fixtures/forms';

/**
 * What a field will take, and what it works out for itself.
 *
 * PaperForge writes no JavaScript into a document and runs none, so the
 * arithmetic and the checking are here, in plain code that can be tested.
 */

const engine = new PdfLibMutationEngine();

describe('reading what a reader typed as a number', () => {
  it('takes the ways people write them', () => {
    expect(toNumber('42')).toBe(42);
    expect(toNumber('1,250.50')).toBe(1250.5);
    expect(toNumber('£19.99')).toBe(19.99);
    expect(toNumber('-3')).toBe(-3);
    expect(toNumber(' 7 ')).toBe(7);
  });

  it('says nothing about what is not a number', () => {
    expect(toNumber('')).toBeNull();
    expect(toNumber('twelve')).toBeNull();
    expect(toNumber(true)).toBeNull();
    expect(toNumber(null)).toBeNull();
  });
});

describe('reading a date', () => {
  it('takes the way the world writes them and the way a computer does', () => {
    expect(readDate('2026-09-23')?.toISOString().slice(0, 10)).toBe('2026-09-23');
    expect(readDate('23/09/2026')?.toISOString().slice(0, 10)).toBe('2026-09-23');
    expect(readDate('23.9.26')?.toISOString().slice(0, 10)).toBe('2026-09-23');
  });

  it('refuses a day that does not exist', () => {
    expect(readDate('31/02/2026')).toBeNull();
    expect(readDate('2026-13-01')).toBeNull();
    expect(readDate('sometime')).toBeNull();
  });
});

describe('what a field will take', () => {
  it('lets anything through when nothing was asked of it', () => {
    expect(validate(NO_FIELD_RULE, 'text', 'anything at all')).toBeNull();
  });

  it('says plainly when a number is wanted', () => {
    const rule: FormFieldRule = { format: 'number', calculation: null };
    expect(validate(rule, 'text', '12.5')).toBeNull();
    expect(validate(rule, 'text', 'twelve')).toMatch(/takes a number/i);
    // An empty field is not a wrong one; required is a separate question.
    expect(validate(rule, 'text', '')).toBeNull();
  });

  it('says plainly when a date is wanted', () => {
    const rule: FormFieldRule = { format: 'date', calculation: null };
    expect(validate(rule, 'text', '2026-09-23')).toBeNull();
    expect(validate(rule, 'text', 'next Tuesday')).toMatch(/takes a date/i);
  });
});

describe('what a field works out', () => {
  const rule = (kind: 'sum' | 'product' | 'average'): FormFieldRule => ({
    format: 'number',
    calculation: { kind, fields: ['a', 'b', 'c'] },
  });
  const values = new Map<string, string>([
    ['a', '2'],
    ['b', '3'],
    ['c', '4'],
  ]);
  const valueOf = (name: string): string | null => values.get(name) ?? null;

  it('adds, multiplies and averages', () => {
    expect(calculate(rule('sum'), valueOf)).toBe('9');
    expect(calculate(rule('product'), valueOf)).toBe('24');
    expect(calculate(rule('average'), valueOf)).toBe('3');
  });

  it('counts only what reads as a number', () => {
    const mixed = (name: string): string | null => (name === 'b' ? 'nothing' : valueOf(name));
    expect(calculate(rule('sum'), mixed)).toBe('6');
    expect(calculate(rule('average'), mixed)).toBe('3');
  });

  it('comes to nothing when there is nothing to work from', () => {
    expect(calculate(rule('sum'), () => null)).toBe('');
    expect(calculate(NO_FIELD_RULE, valueOf)).toBeNull();
  });
});

describe('a rule in the document', () => {
  it('is written on the field and read back', async () => {
    const made = await engine.apply(await buildFormPdf(), [
      {
        kind: 'addFormField',
        page: 1,
        name: 'order.total',
        fieldType: 'text',
        rect: { x: 250, y: 300, width: 120, height: 20 },
        options: null,
        properties: {
          ...DEFAULT_FIELD_PROPERTIES,
          rule: { format: 'number', calculation: { kind: 'sum', fields: ['order.a', 'order.b'] } },
        },
      },
    ]);

    const document = await PDFDocument.load(made.bytes, { updateMetadata: false });
    const field = readFormFields(document).find((entry) => entry.name === 'order.total');

    expect(field?.rule.format).toBe('number');
    expect(field?.rule.calculation).toEqual({ kind: 'sum', fields: ['order.a', 'order.b'] });
  });

  it('is PaperForge’s own, not a script for another reader to run', async () => {
    const made = await engine.apply(await buildFormPdf(), [
      {
        kind: 'addFormField',
        page: 1,
        name: 'order.total',
        fieldType: 'text',
        rect: { x: 250, y: 300, width: 120, height: 20 },
        options: null,
        properties: {
          ...DEFAULT_FIELD_PROPERTIES,
          rule: { format: 'number', calculation: { kind: 'sum', fields: ['order.a'] } },
        },
      },
    ]);

    const document = await PDFDocument.load(made.bytes, { updateMetadata: false });
    const field = readFormFields(document).find((entry) => entry.name === 'order.total');

    // The rule is read back, and nothing about the field is an action: no
    // JavaScript went into the document, and none would be run if it had.
    expect(field?.rule.calculation?.kind).toBe('sum');
    expect(field?.hasScript).toBe(false);
    expect(hasDocumentScript(document)).toBe(false);
  });

  it('goes away again when the field is told to take anything', async () => {
    const withRule = await engine.apply(await buildFormPdf(), [
      {
        kind: 'updateFormField',
        name: 'person.name',
        newName: null,
        rect: null,
        options: null,
        properties: {
          ...DEFAULT_FIELD_PROPERTIES,
          rule: { format: 'date', calculation: null },
        },
      },
    ]);

    const without = await engine.apply(withRule.bytes, [
      {
        kind: 'updateFormField',
        name: 'person.name',
        newName: null,
        rect: null,
        options: null,
        properties: DEFAULT_FIELD_PROPERTIES,
      },
    ]);

    const document = await PDFDocument.load(without.bytes, { updateMetadata: false });
    const field = readFormFields(document).find((entry) => entry.name === 'person.name');
    expect(field?.rule).toEqual(NO_FIELD_RULE);
  });
});
