import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { DocumentRepair, messageLines } from '../../../src/main/services/documents/documentRepair';
import { QpdfExitError, type QpdfService } from '../../../src/main/services/qpdf/qpdfService';
import { PdfLibMutationEngine } from '../../../src/pdf/mutate/pdfLibEngine';
import { checkCrossReference } from '../../../src/pdf/structure/xrefCheck';
import { threePageDocument } from '../../fixtures/pdf';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

/**
 * A document whose cross-reference table points at the wrong bytes: a comment
 * pushed in after the header moves every object along, which is what a
 * careless edit or a truncated transfer typically does to a PDF.
 */
function damagedDocument(): Buffer {
  const bytes = threePageDocument();
  const header = bytes.indexOf('\n') + 1;
  return Buffer.concat([
    bytes.subarray(0, header),
    Buffer.from('% forty bytes of padding nobody accounted for\n', 'latin1'),
    bytes.subarray(header),
  ]);
}

function noQpdf(): QpdfService {
  return {
    resolve: () => Promise.resolve(null),
    status: () =>
      Promise.resolve({ available: false, path: null, version: null, problem: 'Not found.' }),
    check: () => Promise.resolve(undefined),
  } as unknown as QpdfService;
}

let sandbox = '';
let original = '';

function makeRepair(bytes: Uint8Array, qpdf: QpdfService = noQpdf()): DocumentRepair {
  return new DocumentRepair({
    engine: new PdfLibMutationEngine(),
    qpdf,
    logger,
    currentBytes: () => Promise.resolve(bytes),
    workspaceDirectory: () => path.join(sandbox, 'workspace'),
  });
}

beforeEach(async () => {
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'paperforge-repair-'));
  original = path.join(sandbox, 'Broken report.pdf');
  await fs.writeFile(original, damagedDocument());
});

afterEach(async () => {
  await fs.rm(sandbox, { recursive: true, force: true });
});

describe('Check and Repair', () => {
  it('describes a damaged file without qpdf, from what the engine can read', async () => {
    const diagnosis = await makeRepair(damagedDocument()).diagnose('session');
    expect(diagnosis).toMatchObject({
      qpdf: { available: false, verdict: null, messages: ['Not found.'] },
      engine: { readable: true, pageCount: 3, problem: null },
      encrypted: false,
      canRepair: true,
    });
  });

  it('writes a repaired copy beside the original and leaves the original alone', async () => {
    const before = await fs.readFile(original);
    const target = path.join(sandbox, 'Broken report repaired.pdf');
    const outcome = await makeRepair(damagedDocument()).repair('session', original, target);

    expect(outcome).toMatchObject({ canceled: false, path: target, method: 'rewrite' });
    expect(outcome.pageCount).toBe(3);
    expect(await fs.readFile(original)).toEqual(before);

    // The copy is a PDF in its own right, written whole.
    const repaired = await fs.readFile(target);
    const text = repaired.toString('latin1');
    expect(text.startsWith('%PDF-')).toBe(true);
    const document = await PDFDocument.load(repaired);
    expect(document.getPageCount()).toBe(3);
  });

  it('never writes the copy over the file that was opened', async () => {
    await expect(
      makeRepair(damagedDocument()).repair('session', original, original.toUpperCase()),
    ).rejects.toMatchObject({ code: 'io/write-failed' });
  });

  it('lets qpdf rebuild the file when it is installed, and keeps what it said', async () => {
    const run = vi.fn(async (args: readonly string[]) => {
      const [input, output] = args as [string, string];
      // qpdf "repairs" by writing the file out again, and warns as it does.
      const repaired = await new PdfLibMutationEngine().rewrite(await fs.readFile(input));
      await fs.writeFile(output, repaired.bytes);
      throw new QpdfExitError(
        3,
        '',
        `WARNING: ${input}: file is damaged\nWARNING: ${input}: Attempting to reconstruct cross-reference table\n`,
      );
    });
    const qpdf = {
      resolve: () => Promise.resolve('qpdf.exe'),
      run,
      check: () => Promise.resolve({ ok: true, readable: true, output: '' }),
    } as unknown as QpdfService;

    const target = path.join(sandbox, 'Broken report repaired.pdf');
    const outcome = await makeRepair(damagedDocument(), qpdf).repair('session', original, target);

    expect(outcome.method).toBe('qpdf');
    expect(outcome.messages).toEqual([
      'WARNING: the document: file is damaged',
      'WARNING: the document: Attempting to reconstruct cross-reference table',
    ]);
    // Its scratch copies are gone.
    expect(await fs.readdir(path.join(sandbox, 'workspace', 'repair'))).toEqual([]);
  });

  it('falls back to its own engine when qpdf cannot write the file', async () => {
    const qpdf = {
      resolve: () => Promise.resolve('qpdf.exe'),
      run: () => Promise.reject(new QpdfExitError(2, '', 'qpdf: unable to find trailer')),
      check: () => Promise.resolve(undefined),
    } as unknown as QpdfService;

    const target = path.join(sandbox, 'copy.pdf');
    const outcome = await makeRepair(damagedDocument(), qpdf).repair('session', original, target);
    expect(outcome.method).toBe('rewrite');
    expect(outcome.messages[0]).toMatch(/^qpdf:/);
  });

  it('says plainly when nothing can read the file', async () => {
    const garbage = new Uint8Array(Buffer.from('%PDF-1.7\nnothing to see here\n', 'latin1'));
    const repair = makeRepair(garbage);

    const diagnosis = await repair.diagnose('session');
    expect(diagnosis.engine.readable).toBe(false);
    expect(diagnosis.canRepair).toBe(false);
    await expect(
      repair.repair('session', original, path.join(sandbox, 'copy.pdf')),
    ).rejects.toMatchObject({ code: 'pdf/malformed-content' });
  });
});

describe('qpdf messages', () => {
  it('names the working copy as the document and drops the routine lines', () => {
    const output =
      'checking C:\\tmp\\abc-in.pdf\nPDF Version: 1.7\nFile is not encrypted\n' +
      'WARNING: C:\\tmp\\abc-in.pdf (object 5 0): expected endobj\n';
    expect(messageLines(output, 'C:\\tmp\\abc-in.pdf')).toEqual([
      'WARNING: the document (object 5 0): expected endobj',
    ]);
  });
});

describe('the index of objects', () => {
  it('finds every object of a sound file where the file says', () => {
    const check = checkCrossReference(new Uint8Array(threePageDocument()));
    expect(check).toMatchObject({ ok: true, problems: [] });
    expect(check?.checked).toBeGreaterThan(3);
  });

  it('notices when the objects have moved', () => {
    const check = checkCrossReference(new Uint8Array(damagedDocument()));
    expect(check?.ok).toBe(false);
    // Everything moved, the index included.
    expect(check?.problems).toContain('The file says its index of objects is somewhere it is not.');
  });

  it('notices a file that never says where its index is', () => {
    const bytes = new Uint8Array(Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\n', 'latin1'));
    expect(checkCrossReference(bytes)?.problems).toEqual([
      'The file does not say where its index of objects is.',
    ]);
  });

  it('is part of the diagnosis, so damage is reported without qpdf', async () => {
    const diagnosis = await makeRepair(damagedDocument()).diagnose('session');
    expect(diagnosis.index?.ok).toBe(false);
  });
});

it('names the objects a table points past', () => {
  // Two spaces pushed in before object 4: the whitespace still leads to it,
  // but every object after it has moved while the table still gives the old
  // offsets. Only the pointer to the table itself is corrected.
  const text = threePageDocument().toString('latin1');
  const at = text.indexOf('4 0 obj');
  const moved = `${text.slice(0, at)}  ${text.slice(at)}`.replace(
    /startxref\s+(\d+)/,
    (_match, offset: string) => `startxref
${String(Number(offset) + 2)}`,
  );
  const check = checkCrossReference(new Uint8Array(Buffer.from(moved, 'latin1')));
  expect(check?.problems).toHaveLength(1);
  expect(check?.problems[0]).toMatch(/objects are not where the index says \(object 5, 6/);
});
