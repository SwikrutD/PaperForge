import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { DocumentAdmin, mimeTypeFor } from '../../../src/main/services/documents/documentAdmin';
import { StagedAssets } from '../../../src/main/services/documents/stagedAssets';
import { redactSensitive } from '../../../src/main/services/logging/logger';
import { PdfLibMutationEngine } from '../../../src/pdf/mutate/pdfLibEngine';
import type { QpdfSecurity } from '../../../src/main/services/qpdf/qpdfSecurity';
import type { Logger } from '../../../src/main/services/logging/logger';
import { buildPdf } from '../../fixtures/pdf';

const SESSION_ID = 'session-1';
const OPEN_PASSWORD = 'correct horse battery staple';
const PERMISSIONS_PASSWORD = 'owner-secret-4417';

/** A logger that keeps every line, so a test can read back what was written. */
function recordingLogger(): { logger: Logger; lines: string[] } {
  const lines: string[] = [];
  const write =
    (level: string) =>
    (message: string, ...details: unknown[]): void => {
      lines.push(
        redactSensitive(`${level} ${message} ${details.map((detail) => String(detail)).join(' ')}`),
      );
    };
  return {
    lines,
    logger: {
      debug: write('debug'),
      info: write('info'),
      warn: write('warn'),
      error: write('error'),
    },
  };
}

describe('document administration', () => {
  let directory: string;
  let admin: DocumentAdmin;
  let lines: string[];
  let stagedAssets: StagedAssets;
  let security: {
    encrypt: Mock<(input: string, output: string) => Promise<void>>;
    decrypt: Mock<(input: string, output: string) => Promise<void>>;
    available: Mock<() => Promise<boolean>>;
  };
  let bytes: Uint8Array;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'paperforge-admin-'));
    bytes = buildPdf({
      pages: [{ text: 'Hello' }],
      info: { Title: 'A document' },
      attachments: [{ fileName: 'notes.txt', content: 'carried along' }],
    });

    const recorded = recordingLogger();
    lines = recorded.lines;
    stagedAssets = new StagedAssets();

    security = {
      available: vi.fn(() => Promise.resolve(true)),
      // A stand-in for qpdf: it copies the input so the pipeline can be
      // exercised on a machine that has no qpdf installed.
      encrypt: vi.fn(async (input: string, output: string) => {
        await fs.copyFile(input, output);
      }),
      decrypt: vi.fn(async (input: string, output: string) => {
        await fs.copyFile(input, output);
      }),
    };

    admin = new DocumentAdmin({
      engine: new PdfLibMutationEngine(),
      security: security as unknown as QpdfSecurity,
      stagedAssets,
      logger: recorded.logger,
      currentBytes: () => Promise.resolve(bytes),
      workspaceDirectory: () => directory,
    });
  });

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  it('reports properties and the security summary together', async () => {
    const properties = await admin.properties(SESSION_ID);

    expect(properties.metadata.title).toBe('A document');
    expect(properties.security.encrypted).toBe(false);
  });

  it('describes an encrypted document it cannot open', async () => {
    bytes = buildPdf({ pages: [{ text: 'Secret' }], password: 'letmein' });
    const properties = await admin.properties(SESSION_ID);

    expect(properties.security.encrypted).toBe(true);
    expect(properties.security.openPasswordRequired).toBe(true);
    // Nothing is invented about a document that could not be read through.
    expect(properties.pageCount).toBe(0);
    expect(properties.metadata.title).toBeNull();
  });

  it('writes an attachment where the reader asked, and does not open it', async () => {
    const destination = path.join(directory, 'saved.txt');
    await admin.saveAttachment(SESSION_ID, 'notes.txt', destination);

    expect(await fs.readFile(destination, 'utf8')).toBe('carried along');
  });

  it('refuses to save an attachment that is not there', async () => {
    await expect(
      admin.saveAttachment(SESSION_ID, 'missing.txt', path.join(directory, 'out.txt')),
    ).rejects.toMatchObject({ code: 'io/not-found' });
  });

  it('stages a file with its name, size and whether Windows would run it', async () => {
    const source = path.join(directory, 'installer.exe');
    await fs.writeFile(source, 'MZ-not-really');

    const staged = await admin.stageAttachment(SESSION_ID, source);
    expect(staged).toMatchObject({ fileName: 'installer.exe', sizeBytes: 13, risky: true });
    expect(stagedAssets.assetsFor(SESSION_ID).get(staged.token)?.kind).toBe('file');
  });

  it('writes a protected copy without touching the open document', async () => {
    const destination = path.join(directory, 'protected.pdf');
    await admin.protect(
      SESSION_ID,
      {
        sessionId: SESSION_ID,
        openPassword: OPEN_PASSWORD,
        permissionsPassword: PERMISSIONS_PASSWORD,
        keyLengthBits: 256,
        permissions: {
          print: 'full',
          modify: 'all',
          extract: true,
          extractForAccessibility: true,
        },
        encryptMetadata: true,
      },
      destination,
    );

    expect((await fs.readFile(destination)).subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(security.encrypt).toHaveBeenCalledOnce();
  });

  /**
   * The gate for this segment. A password reaches the main process, is handed
   * to qpdf and must appear nowhere else — not in a log line, not in an error,
   * not in a file left behind.
   */
  it('never writes a password to the log', async () => {
    await admin.protect(
      SESSION_ID,
      {
        sessionId: SESSION_ID,
        openPassword: OPEN_PASSWORD,
        permissionsPassword: PERMISSIONS_PASSWORD,
        keyLengthBits: 256,
        permissions: {
          print: 'full',
          modify: 'all',
          extract: true,
          extractForAccessibility: true,
        },
        encryptMetadata: true,
      },
      path.join(directory, 'protected.pdf'),
    );
    await admin.unprotect(SESSION_ID, OPEN_PASSWORD, path.join(directory, 'plain.pdf'));

    const written = lines.join('\n');
    expect(written).not.toContain(OPEN_PASSWORD);
    expect(written).not.toContain(PERMISSIONS_PASSWORD);
    // It still says what happened, which is the point of logging it at all.
    expect(written).toContain('Wrote a protected copy.');
    expect(written).toContain('open password set');
  });

  it('leaves no working copy behind, whether it succeeded or failed', async () => {
    await admin.protect(
      SESSION_ID,
      {
        sessionId: SESSION_ID,
        openPassword: OPEN_PASSWORD,
        permissionsPassword: '',
        keyLengthBits: 256,
        permissions: {
          print: 'full',
          modify: 'all',
          extract: true,
          extractForAccessibility: true,
        },
        encryptMetadata: true,
      },
      path.join(directory, 'protected.pdf'),
    );

    security.encrypt.mockRejectedValueOnce(new Error('qpdf said no'));
    await expect(
      admin.protect(
        SESSION_ID,
        {
          sessionId: SESSION_ID,
          openPassword: OPEN_PASSWORD,
          permissionsPassword: '',
          keyLengthBits: 256,
          permissions: {
            print: 'full',
            modify: 'all',
            extract: true,
            extractForAccessibility: true,
          },
          encryptMetadata: true,
        },
        path.join(directory, 'failed.pdf'),
      ),
    ).rejects.toThrow();

    const left = await fs.readdir(path.join(directory, 'security')).catch(() => []);
    expect(left).toEqual([]);
  });

  it('says plainly when qpdf is not installed', async () => {
    security.available.mockResolvedValueOnce(false);

    await expect(
      admin.unprotect(SESSION_ID, 'anything', path.join(directory, 'plain.pdf')),
    ).rejects.toMatchObject({ code: 'sidecar/missing' });
  });

  it('refuses to publish something that is not a PDF', async () => {
    security.decrypt.mockImplementationOnce((_input, output) =>
      fs.writeFile(output, 'this is not a pdf'),
    );

    const destination = path.join(directory, 'plain.pdf');
    await expect(admin.unprotect(SESSION_ID, 'anything', destination)).rejects.toMatchObject({
      code: 'io/write-failed',
    });
    await expect(fs.stat(destination)).rejects.toThrow();
  });
});

describe('media types', () => {
  it('names the types it recognises and guesses at nothing else', () => {
    expect(mimeTypeFor('report.pdf')).toBe('application/pdf');
    expect(mimeTypeFor('sheet.XLSX')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(mimeTypeFor('archive.tar.gz')).toBeNull();
    expect(mimeTypeFor('README')).toBeNull();
  });
});
