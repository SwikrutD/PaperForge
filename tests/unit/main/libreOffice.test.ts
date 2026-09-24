import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LibreOfficeProvider } from '../../../src/main/services/conversion/libreOffice';
import type { Logger } from '../../../src/main/services/logging/logger';
import { AppError } from '../../../src/shared/errors/appError';
import { DEFAULT_PAGE_SETUP } from '../../../src/shared/schemas/create';

/**
 * Office documents, converted by a local LibreOffice.
 *
 * LibreOffice is not bundled and may not be installed, so what is tested here
 * is what PaperForge itself does: how it is asked to run, what is done with
 * what it produces, and what the reader is told when it is not there.
 */

const logger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function provider(options: {
  configuredPath?: string | null;
  run?: (
    executable: string,
    args: readonly string[],
  ) => Promise<{ stdout: string; stderr: string }>;
}): LibreOfficeProvider {
  return new LibreOfficeProvider({
    logger,
    ...(options.configuredPath === undefined ? {} : { configuredPath: options.configuredPath }),
    run: async (executable, args) => {
      const result = await options.run?.(executable, args);
      return result ?? { stdout: '', stderr: '' };
    },
  });
}

/** A file standing in for LibreOffice, so discovery finds something. */
async function fakeExecutable(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'paperforge-office-'));
  const executable = path.join(directory, 'soffice.exe');
  await fs.writeFile(executable, 'not really LibreOffice');
  return executable;
}

describe('when LibreOffice is not there', () => {
  it('says so in words a reader can act on, and does not pretend', async () => {
    const office = provider({ configuredPath: path.join(os.tmpdir(), 'no-such-soffice.exe') });

    const problem = await office.availability();
    expect(problem).toMatch(/cannot find one/i);
    expect(problem).toMatch(/nothing is uploaded/i);

    const status = await office.status();
    expect(status.available).toBe(false);
    expect(status.version).toBeNull();
  });

  it('refuses a file rather than producing nothing', async () => {
    const office = provider({ configuredPath: path.join(os.tmpdir(), 'no-such-soffice.exe') });

    await expect(
      office.toPdf(
        {
          bytes: new Uint8Array(),
          fileName: 'Report.docx',
          extension: 'docx',
          path: 'C:/Report.docx',
        },
        DEFAULT_PAGE_SETUP,
      ),
    ).rejects.toThrow(AppError);
  });
});

describe('when LibreOffice is there', () => {
  it('says which one it found', async () => {
    const executable = await fakeExecutable();
    const office = provider({
      configuredPath: executable,
      run: () => Promise.resolve({ stdout: 'LibreOffice 24.8.1.2 abc\n', stderr: '' }),
    });

    const status = await office.status();
    expect(status.available).toBe(true);
    expect(status.path).toBe(executable);
    expect(status.version).toBe('LibreOffice 24.8.1.2 abc');
  });

  it('asks it to convert headlessly, into a folder of PaperForge own', async () => {
    const executable = await fakeExecutable();
    const source = path.join(path.dirname(executable), 'Report.docx');
    await fs.writeFile(source, 'a document');

    let asked: readonly string[] = [];
    const office = provider({
      configuredPath: executable,
      run: async (_executable, args) => {
        asked = args;
        // Stand in for LibreOffice: write the PDF it would have written.
        const outdir = args[args.indexOf('--outdir') + 1] ?? '';
        await fs.writeFile(path.join(outdir, 'Report.pdf'), '%PDF-1.7\nconverted\n');
        return { stdout: '', stderr: '' };
      },
    });

    const bytes = await office.toPdf(
      { bytes: new Uint8Array(), fileName: 'Report.docx', extension: 'docx', path: source },
      DEFAULT_PAGE_SETUP,
    );

    expect(new TextDecoder().decode(bytes)).toContain('%PDF');
    expect(asked).toContain('--headless');
    expect(asked).toContain('--convert-to');
    expect(asked[asked.indexOf('--convert-to') + 1]).toBe('pdf');
    expect(asked).toContain(source);
    // A profile of its own, so a LibreOffice the reader has open is untouched.
    expect(asked.some((argument) => argument.includes('UserInstallation'))).toBe(true);
  });

  it('says plainly when it produced nothing', async () => {
    const executable = await fakeExecutable();
    const office = provider({
      configuredPath: executable,
      run: () => Promise.resolve({ stdout: '', stderr: '' }),
    });

    await expect(
      office.toPdf(
        {
          bytes: new Uint8Array(),
          fileName: 'Locked.docx',
          extension: 'docx',
          path: path.join(path.dirname(executable), 'Locked.docx'),
        },
        DEFAULT_PAGE_SETUP,
      ),
    ).rejects.toThrow(/did not produce a PDF/i);
  });

  it('takes the Office kinds a reader would expect', () => {
    const office = provider({});
    for (const extension of ['docx', 'doc', 'odt', 'xlsx', 'ods', 'pptx', 'odp', 'rtf']) {
      expect(office.extensions).toContain(extension);
    }
  });
});
