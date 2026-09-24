import { PDFArray, PDFDict, PDFName, PDFString, type PDFDocument, type PDFField } from 'pdf-lib';
import type { FormFieldRule, FormFieldType, FormValue } from '@shared/schemas/form';

/**
 * What a field will accept, and what it works out for itself.
 *
 * Acrobat writes these as document JavaScript. PaperForge will not run
 * JavaScript, so it will not write any either: a rule is kept in the field's
 * own dictionary under `/PFRule`, which every other reader ignores, and
 * PaperForge does the arithmetic itself while the form is filled in.
 */

const RULE = PDFName.of('PFRule');

export const NO_RULE: FormFieldRule = { format: 'text', calculation: null };

/** Reads the rule PaperForge wrote on a field, if it wrote one. */
export function readRule(document: PDFDocument, field: PDFField): FormFieldRule {
  const rule = field.acroField.dict.lookup(RULE);
  if (!(rule instanceof PDFDict)) return NO_RULE;

  const format = nameOf(rule, 'Format');
  const calculation = rule.lookup(PDFName.of('Calc'));

  return {
    format: format === 'number' || format === 'date' ? format : 'text',
    calculation:
      calculation instanceof PDFDict
        ? {
            kind: kindOf(nameOf(calculation, 'Kind')),
            fields: stringsOf(document, calculation.lookup(PDFName.of('Fields'))),
          }
        : null,
  };
}

/** Writes a rule onto a field, or takes it off when there is nothing to say. */
export function writeRule(document: PDFDocument, field: PDFField, rule: FormFieldRule): void {
  const dict = field.acroField.dict;
  if (rule.format === 'text' && rule.calculation === null) {
    dict.delete(RULE);
    return;
  }

  const entries: Record<string, unknown> = { Format: PDFName.of(rule.format) };
  if (rule.calculation !== null) {
    entries['Calc'] = {
      Kind: PDFName.of(rule.calculation.kind),
      Fields: rule.calculation.fields.map((name) => PDFString.of(name)),
    };
  }

  dict.set(RULE, document.context.obj(entries as never));
}

function nameOf(dict: PDFDict, key: string): string | null {
  const value = dict.lookup(PDFName.of(key));
  return value instanceof PDFName ? value.decodeText() : null;
}

function kindOf(value: string | null): 'sum' | 'product' | 'average' {
  return value === 'product' || value === 'average' ? value : 'sum';
}

function stringsOf(document: PDFDocument, value: unknown): string[] {
  if (!(value instanceof PDFArray)) return [];
  const names: string[] = [];
  for (let index = 0; index < value.size(); index += 1) {
    const entry = document.context.lookup(value.get(index));
    if (entry instanceof PDFString) names.push(entry.decodeText());
  }
  return names;
}

/**
 * What a field works out from the others, when it works anything out.
 *
 * Only numbers take part: a field that holds something else counts as
 * nothing, which is what a reader expects of a total.
 */
export function calculate(
  rule: FormFieldRule,
  valueOf: (name: string) => FormValue | null,
): string | null {
  const calculation = rule.calculation;
  if (calculation === null || calculation.fields.length === 0) return null;

  const numbers = calculation.fields
    .map((name) => toNumber(valueOf(name)))
    .filter((value): value is number => value !== null);
  if (numbers.length === 0) return '';

  const total = numbers.reduce((sum, value) => sum + value, 0);
  const product = numbers.reduce((result, value) => result * value, 1);

  const result =
    calculation.kind === 'sum'
      ? total
      : calculation.kind === 'product'
        ? product
        : total / numbers.length;

  // Enough places for money and measurements, without a tail of noughts.
  return String(Math.round(result * 1_000_000) / 1_000_000);
}

/** A field's value as a number, when it reads as one. */
export function toNumber(value: FormValue | null): number | null {
  if (typeof value === 'number') return value;
  if (value === null || typeof value === 'boolean') return null;

  const text = (Array.isArray(value) ? (value[0] ?? '') : value).trim();
  if (text === '') return null;

  // Thousands separators — including the non-breaking kind — and a currency
  // mark are what people type.
  const cleaned = text.replace(/[\s,\u00a0]/gu, '').replace(/^[^\d+-.]+/u, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '+') return null;

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Whether a value is one the field will take, in words for the reader.
 *
 * Returns null when there is nothing wrong with it.
 */
export function validate(
  rule: FormFieldRule,
  type: FormFieldType,
  value: FormValue | null,
): string | null {
  if (type !== 'text' || value === null || typeof value !== 'string' || value.trim() === '') {
    return null;
  }

  if (rule.format === 'number') {
    return toNumber(value) === null ? 'This field takes a number.' : null;
  }

  if (rule.format === 'date') {
    return readDate(value) === null
      ? 'This field takes a date, such as 2026-09-23 or 23/09/2026.'
      : null;
  }

  return null;
}

/**
 * A date the reader has typed.
 *
 * Both the way the world writes dates and the way a computer does: day first
 * when the parts are separated by slashes or dots, year first when by dashes.
 */
export function readDate(value: string): Date | null {
  const text = value.trim();

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (iso !== null) return madeDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const dayFirst = /^(\d{1,2})[./](\d{1,2})[./](\d{2,4})$/.exec(text);
  if (dayFirst !== null) {
    const year = Number(dayFirst[3]);
    return madeDate(year < 100 ? 2000 + year : year, Number(dayFirst[2]), Number(dayFirst[1]));
  }

  return null;
}

function madeDate(year: number, month: number, day: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
}
