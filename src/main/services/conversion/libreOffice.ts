import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppError } from '@shared/errors/appError';
import type { PageSetup } from '@shared/schemas/create';
import type { OfficeStatus } from '@shared/schemas/convert';
import type { ConversionProvider, SourceInput } from '@conversion/models/provider';
import type { Logger } from '../logging/logger';

/** A large presentation can take a while to convert; a stuck one should not hang. */
const RUN_TIMEOUT_MS = 180_000;

/** What a local LibreOffice can turn into a PDF. */
export const OFFICE_EXTENSIONS = [
  'doc',
  'docx',
  'odt',
  'rtf',
  'xls',
  'xlsx',
  'ods',
  'ppt',
  'pptx',
  'odp',
] as const;

/** Runs a program and says what it said. Replaced in tests. */
export type OfficeRunner = (
  executable: string,
  args: readonly string[],
  options: { timeoutMs: number },
) => Promise<{ stdout: string; stderr: string }>;

export interface LibreOfficeOptions {
  logger: Logger;
  configuredPath?: string | null;
  /** Injected so the argument building can be tested without LibreOffice. */
  run?: OfficeRunner;
}

/**
 * Office documents, converted by a local LibreOffice.
 *
 * LibreOffice is a separate program PaperForge does not ship, does not
 * download and does not require: without it, Office files are refused with a
 * reason the reader can act on, and everything else in PaperForge carries on
 * working. What it produces is what LibreOffice produces — PaperForge claims
 * no fidelity of its own over it.
 */
export class LibreOfficeProvider implements ConversionProvider {
  readonly id = 'libreoffice';
  readonly label = 'Office documents';
  readonly extensions = [...OFFICE_EXTENSIONS];

  private discovery: Promise<string | null> | undefined;
  private configuredPath: string | null;
  private readonly run: OfficeRunner;

  constructor(private readonly options: LibreOfficeOptions) {
    this.configuredPath = options.configuredPath ?? null;
    this.run = options.run ?? runProgram;
  }

  setConfiguredPath(officePath: string | null): void {
    if (this.configuredPath === officePath) return;
    this.configuredPath = officePath;
    this.discovery = undefined;
  }

  async resolve(): Promise<string | null> {
    this.discovery ??= this.discover();
    return this.discovery;
  }

  async availability(): Promise<string | null> {
    const executable = await this.resolve();
    return executable === null
      ? 'PaperForge converts Office documents with a local LibreOffice, and cannot find one. Install LibreOffice, or point PaperForge at it in Settings. Nothing is uploaded either way.'
      : null;
  }

  async status(): Promise<OfficeStatus> {
    const executable = await this.resolve();
    if (executable === null) {
      return {
        available: false,
        path: null,
        version: null,
        problem: (await this.availability()) ?? 'Not found.',
      };
    }

    try {
      const result = await this.run(executable, ['--version'], { timeoutMs: 20_000 });
      return {
        available: true,
        path: executable,
        version: `${result.stdout}\n${result.stderr}`.split('\n')[0]?.trim() ?? null,
        problem: null,
      };
    } catch (error) {
      return {
        available: false,
        path: executable,
        version: null,
        problem: AppError.serialize(error).message,
      };
    }
  }

  /**
   * Converts one file. The page setup is LibreOffice's own: the document says
   * what paper it is on, and PaperForge does not second-guess it.
   */
  async toPdf(input: SourceInput, setup: PageSetup): Promise<Uint8Array> {
    void setup;
    const executable = await this.resolve();
    if (executable === null) {
      throw new AppError('conversion/provider-unavailable', {
        message: (await this.availability()) ?? 'LibreOffice was not found.',
      });
    }

    const directory = path.join(os.tmpdir(), 'PaperForge', 'office', randomUUID());
    await fs.mkdir(directory, { recursive: true });

    // A profile of its own, so a LibreOffice the reader has open keeps working
    // and PaperForge never touches their settings.
    const profile = path.join(directory, 'profile');

    try {
      await this.run(
        executable,
        [
          '--headless',
          '--norestore',
          '--nolockcheck',
          `-env:UserInstallation=file:///${profile.replace(/\\/g, '/')}`,
          '--convert-to',
          'pdf',
          '--outdir',
          directory,
          input.path,
        ],
        { timeoutMs: RUN_TIMEOUT_MS },
      );

      const produced = await findPdf(directory, input.fileName);
      if (produced === null) {
        throw new AppError('conversion/provider-unavailable', {
          message: `LibreOffice did not produce a PDF from ${input.fileName}.`,
          details: 'The file may be password-protected or of a kind it cannot read.',
        });
      }

      this.options.logger.info('Converted an Office document.', input.fileName);
      return new Uint8Array(await fs.readFile(produced));
    } finally {
      await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async discover(): Promise<string | null> {
    const candidates: string[] = [];
    const configured = this.configuredPath?.trim();
    if (configured !== undefined && configured !== '') candidates.push(configured);

    for (const root of [process.env['ProgramFiles'], process.env['ProgramFiles(x86)']]) {
      if (root !== undefined) {
        candidates.push(path.join(root, 'LibreOffice', 'program', 'soffice.exe'));
      }
    }

    for (const candidate of candidates) {
      if (await isFile(candidate)) {
        this.options.logger.info('Found LibreOffice.', candidate);
        return candidate;
      }
    }

    const fromPath = await findOnPath();
    if (fromPath !== null) this.options.logger.info('Found LibreOffice on the PATH.', fromPath);
    else
      this.options.logger.info('LibreOffice is not installed; Office files cannot be converted.');
    return fromPath;
  }
}

/** The PDF LibreOffice wrote, which takes the source file's own name. */
async function findPdf(directory: string, fileName: string): Promise<string | null> {
  const expected = `${path.basename(fileName, path.extname(fileName))}.pdf`;
  const entries = await fs.readdir(directory).catch(() => []);

  const exact = entries.find((entry) => entry === expected);
  if (exact !== undefined) return path.join(directory, exact);

  // LibreOffice sometimes tidies the name; any PDF in a folder of our own is
  // the one it just wrote.
  const anyPdf = entries.find((entry) => entry.toLowerCase().endsWith('.pdf'));
  return anyPdf === undefined ? null : path.join(directory, anyPdf);
}

const runProgram: OfficeRunner = (executable, args, options) =>
  new Promise((resolve, reject) => {
    execFile(
      executable,
      [...args],
      { timeout: options.timeoutMs, windowsHide: true, shell: false },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ stdout, stderr });
          return;
        }
        reject(
          new AppError('conversion/provider-unavailable', {
            message: 'LibreOffice could not be run.',
            details: `${error.message}${stderr === '' ? '' : `: ${stderr.slice(0, 500)}`}`,
            cause: error,
          }),
        );
      },
    );
  });

async function findOnPath(): Promise<string | null> {
  const name = process.platform === 'win32' ? 'soffice.exe' : 'soffice';
  for (const entry of (process.env['PATH'] ?? '').split(path.delimiter)) {
    if (entry === '') continue;
    const candidate = path.join(entry, name);
    if (await isFile(candidate)) return candidate;
  }
  return null;
}

async function isFile(candidate: string): Promise<boolean> {
  try {
    return (await fs.stat(candidate)).isFile();
  } catch {
    return false;
  }
}
