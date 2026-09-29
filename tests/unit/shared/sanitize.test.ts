import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { PdfLibMutationEngine } from '../../../src/pdf/mutate/pdfLibEngine';
import { readFormFields } from '../../../src/pdf/forms/read';
import type { SanitizeCategory, SanitizeReport } from '../../../src/shared/schemas/sanitize';
import { buildPdf } from '../../fixtures/pdf';
import { buildFormPdf } from '../../fixtures/forms';

const engine = new PdfLibMutationEngine();

function countOf(report: SanitizeReport, category: SanitizeCategory): number {
  return report.findings.find((finding) => finding.category === category)?.count ?? 0;
}

/** A document carrying one of everything the sanitizer knows how to find. */
function loadedDocument(): Buffer {
  return buildPdf({
    pages: [
      {
        text: 'Visible',
        annotations: [
          // Flag 2 is Hidden: a comment that is in the file but not on show.
          '<< /Type /Annot /Subtype /Text /Rect [10 10 30 30] /F 2 /Contents (a hidden note) >>',
          '<< /Type /Annot /Subtype /Text /Rect [40 10 60 30] /Contents (an ordinary note) >>',
        ],
      },
    ],
    info: { Title: 'Report', Author: 'A. Writer', Producer: 'Something' },
    xmp: '<?xpacket begin="" ?><x:xmpmeta xmlns:x="adobe:ns:meta/"/><?xpacket end="r"?>',
    attachments: [{ fileName: 'notes.txt', content: 'carried along' }],
    javaScript: { Startup: 'app.alert("hello");' },
    openAction: '<< /S /Launch /F (C:\\\\Windows\\\\System32\\\\calc.exe) >>',
    thumbnails: true,
  });
}

describe('scanning for hidden information', () => {
  it('finds nothing in a document that carries nothing', async () => {
    const report = await engine.scanHiddenInformation(buildPdf({ pages: [{ text: 'Plain' }] }));
    const found = report.findings.filter((finding) => finding.count > 0);

    expect(found).toEqual([]);
  });

  it('reports every category it can detect', async () => {
    const report = await engine.scanHiddenInformation(loadedDocument());

    expect(countOf(report, 'metadata')).toBe(3);
    expect(countOf(report, 'xmpMetadata')).toBe(1);
    expect(countOf(report, 'attachments')).toBe(1);
    expect(countOf(report, 'documentJavaScript')).toBe(1);
    expect(countOf(report, 'launchActions')).toBe(1);
    expect(countOf(report, 'hiddenAnnotations')).toBe(1);
    expect(countOf(report, 'thumbnails')).toBe(1);
  });

  it('names what it found, so the reader is not asked to trust a number', async () => {
    const report = await engine.scanHiddenInformation(loadedDocument());
    const attachments = report.findings.find((finding) => finding.category === 'attachments');

    expect(attachments?.detail).toContain('notes.txt');
  });

  it('finds the values a form holds, and names the fields holding them', async () => {
    const report = await engine.scanHiddenInformation(await buildFormPdf());
    const finding = report.findings.find((entry) => entry.category === 'formData');

    expect(finding?.count).toBeGreaterThan(0);
    expect(finding?.detail).toContain('person.name');
  });

  it('says when a file has been written more than once', async () => {
    const once = await engine.scanHiddenInformation(buildPdf({ pages: [{ text: 'Plain' }] }));
    expect(once.hasIncrementalUpdates).toBe(false);

    const twice = Buffer.concat([
      buildPdf({ pages: [{ text: 'Plain' }] }),
      Buffer.from('trailer\n<< >>\nstartxref\n0\n%%EOF\n', 'latin1'),
    ]);
    expect((await engine.scanHiddenInformation(twice)).hasIncrementalUpdates).toBe(true);
  });
});

describe('removing hidden information', () => {
  it('removes only the categories chosen', async () => {
    const result = await engine.apply(loadedDocument(), [
      { kind: 'sanitize', categories: ['metadata', 'attachments'] },
    ]);
    const report = await engine.scanHiddenInformation(result.bytes);

    expect(countOf(report, 'metadata')).toBe(0);
    expect(countOf(report, 'attachments')).toBe(0);
    // Untouched, because they were not chosen.
    expect(countOf(report, 'documentJavaScript')).toBe(1);
    expect(countOf(report, 'hiddenAnnotations')).toBe(1);
  });

  it('removes everything when everything is chosen', async () => {
    const report = await engine.scanHiddenInformation(loadedDocument());
    const categories = report.findings
      .filter((finding) => finding.count > 0)
      .map((finding) => finding.category);

    const result = await engine.apply(loadedDocument(), [{ kind: 'sanitize', categories }]);
    const after = await engine.scanHiddenInformation(result.bytes);

    expect(after.findings.filter((finding) => finding.count > 0)).toEqual([]);
  });

  /**
   * The point of removing a script is that it is gone, not merely unlisted.
   * PaperForge never runs one either way.
   */
  it('leaves no trace of a removed script or launch action', async () => {
    const result = await engine.apply(loadedDocument(), [
      { kind: 'sanitize', categories: ['documentJavaScript', 'launchActions'] },
    ]);
    const text = Buffer.from(result.bytes).toString('latin1');

    expect(text).not.toContain('app.alert');
    expect(text).not.toContain('calc.exe');
    expect(text).not.toContain('/JavaScript');
  });

  it('keeps the comments that were on show', async () => {
    const result = await engine.apply(loadedDocument(), [
      { kind: 'sanitize', categories: ['hiddenAnnotations'] },
    ]);

    const annotations = await engine.readAnnotations(result.bytes);
    expect(annotations.map((annotation) => annotation.contents)).toEqual(['an ordinary note']);
  });

  it('empties a form without taking its fields away', async () => {
    const filled = await engine.apply(await buildFormPdf(), [
      { kind: 'setFieldValues', values: [{ name: 'person.name', value: 'Grace Hopper' }] },
    ]);
    const cleaned = await engine.apply(filled.bytes, [
      { kind: 'sanitize', categories: ['formData'] },
    ]);

    expect(countOf(await engine.scanHiddenInformation(cleaned.bytes), 'formData')).toBe(0);

    // The fields are still there to be filled in again — that is what makes
    // this different from flattening.
    const document = await PDFDocument.load(cleaned.bytes, { updateMetadata: false });
    const fields = readFormFields(document);
    expect(fields.map((field) => field.name)).toContain('person.name');
    // A text field with no /V reads back as holding nothing.
    expect(fields.find((field) => field.name === 'person.name')?.value).toBe('');
  });

  it('keeps the pages, whatever else it takes out', async () => {
    const result = await engine.apply(loadedDocument(), [
      {
        kind: 'sanitize',
        categories: ['metadata', 'xmpMetadata', 'attachments', 'documentJavaScript'],
      },
    ]);

    expect(result.pageCount).toBe(1);
    expect(Buffer.from(result.bytes).toString('latin1')).toContain('Visible');
  });
});
