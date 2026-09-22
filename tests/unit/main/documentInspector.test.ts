import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  documentIdForPath,
  inspectDocument,
} from '../../../src/main/services/documents/documentInspector';
import { AppError } from '../../../src/shared/errors/appError';

let directory = '';

/** A minimal but structurally real PDF. */
function pdfBytes(options: { version?: string; encrypted?: boolean } = {}): Buffer {
  const version = options.version ?? '1.7';
  const encryptEntry = options.encrypted === true ? ' /Encrypt 5 0 R' : '';
  return Buffer.from(
    `%PDF-${version}\n` +
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n' +
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n' +
      'trailer\n' +
      `<< /Size 4 /Root 1 0 R${encryptEntry} >>\n` +
      'startxref\n0\n%%EOF\n',
    'latin1',
  );
}

async function writeFile(name: string, contents: Buffer | string): Promise<string> {
  const filePath = path.join(directory, name);
  await fs.writeFile(filePath, contents);
  return filePath;
}

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'paperforge-inspect-'));
});

afterEach(async () => {
  await fs.chmod(directory, 0o700).catch(() => undefined);
  await fs.rm(directory, { recursive: true, force: true });
});

describe('inspectDocument', () => {
  it('reads the facts of an ordinary PDF', async () => {
    const filePath = await writeFile('report.pdf', pdfBytes());
    const info = await inspectDocument(filePath);

    expect(info).toMatchObject({
      path: filePath,
      displayName: 'report.pdf',
      pdfVersion: '1.7',
      encryptionDetected: false,
      readOnly: false,
    });
    expect(info.sizeBytes).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(info.modifiedAt))).toBe(false);
  });

  it('handles spaces and non-ASCII names', async () => {
    const filePath = await writeFile('Rapport final é 日本.pdf', pdfBytes({ version: '1.4' }));
    const info = await inspectDocument(filePath);

    expect(info.displayName).toBe('Rapport final é 日本.pdf');
    expect(info.pdfVersion).toBe('1.4');
  });

  it('flags a PDF whose trailer declares encryption', async () => {
    const filePath = await writeFile('locked.pdf', pdfBytes({ encrypted: true }));
    expect((await inspectDocument(filePath)).encryptionDetected).toBe(true);
  });

  it('reports a read-only file', async () => {
    const filePath = await writeFile('readonly.pdf', pdfBytes());
    await fs.chmod(filePath, 0o444);

    expect((await inspectDocument(filePath)).readOnly).toBe(true);
    await fs.chmod(filePath, 0o666);
  });

  it('rejects a file that is not a PDF', async () => {
    const filePath = await writeFile('notes.txt', 'just some text, definitely not a PDF');
    await expect(inspectDocument(filePath)).rejects.toMatchObject({ code: 'pdf/invalid' });
    await expect(inspectDocument(filePath)).rejects.toBeInstanceOf(AppError);
  });

  it('rejects an empty file', async () => {
    const filePath = await writeFile('empty.pdf', '');
    await expect(inspectDocument(filePath)).rejects.toMatchObject({ code: 'pdf/invalid' });
  });

  it('reports a missing file as not found', async () => {
    await expect(inspectDocument(path.join(directory, 'gone.pdf'))).rejects.toMatchObject({
      code: 'io/not-found',
    });
  });

  it('refuses a directory', async () => {
    await expect(inspectDocument(directory)).rejects.toMatchObject({ code: 'io/not-found' });
  });

  it('finds a header that is not at byte zero', async () => {
    const filePath = await writeFile(
      'padded.pdf',
      Buffer.concat([Buffer.from('junk before the header\n'), pdfBytes()]),
    );
    expect((await inspectDocument(filePath)).pdfVersion).toBe('1.7');
  });
});

describe('documentIdForPath', () => {
  it('is stable and case-insensitive, like Windows paths', () => {
    expect(documentIdForPath('C:/Docs/Report.pdf')).toBe(documentIdForPath('c:/docs/report.pdf'));
    expect(documentIdForPath('C:/Docs/Report.pdf')).not.toBe(
      documentIdForPath('C:/Docs/Other.pdf'),
    );
  });

  it('ignores path spelling differences', () => {
    expect(documentIdForPath('C:/Docs/../Docs/Report.pdf')).toBe(
      documentIdForPath('C:/Docs/Report.pdf'),
    );
  });
});
