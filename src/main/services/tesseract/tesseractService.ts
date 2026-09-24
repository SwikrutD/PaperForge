import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppError } from '@shared/errors/appError';
import type { OcrOptions, OcrStatus } from '@shared/schemas/ocr';
import { parseTsv, type ParsedPage } from './tsv';
import type { Logger } from '../logging/logger';

/** A page of dense text can take a while; a stuck run should not take forever. */
const RUN_TIMEOUT_MS = 180_000;
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

export interface TesseractServiceOptions {
  logger: Logger;
  /** Where the application keeps its bundled sidecars, when it has any. */
  resourcesRoot: string;
  /** An executable the reader pointed PaperForge at, which wins over discovery. */
  configuredPath?: string | null;
  /** A folder of language data the reader chose, which wins over the default. */
  configuredTessdata?: string | null;
}

/**
 * Runs the local Tesseract binary.
 *
 * Everything about recognition happens on this computer: the binary is local,
 * the language data is local, and nothing is downloaded at any point. The
 * executable is only ever launched from here, with an argument array and no
 * shell, and a cancelled run kills the child process.
 */
export class TesseractService {
  private discovery: Promise<string | null> | undefined;
  private installed: Promise<string[]> | undefined;
  private configuredPath: string | null;
  private configuredTessdata: string | null;

  constructor(private readonly options: TesseractServiceOptions) {
    this.configuredPath = options.configuredPath ?? null;
    this.configuredTessdata = options.configuredTessdata ?? null;
  }

  /** Points the service at a different executable, or at different language data. */
  configure(paths: { executable?: string | null; tessdata?: string | null }): void {
    if (paths.executable !== undefined && paths.executable !== this.configuredPath) {
      this.configuredPath = paths.executable;
      this.discovery = undefined;
      this.installed = undefined;
    }
    if (paths.tessdata !== undefined) {
      this.configuredTessdata = paths.tessdata;
      this.installed = undefined;
    }
  }

  /** The executable to run, or null when Tesseract is not installed. */
  async resolve(): Promise<string | null> {
    this.discovery ??= this.discover();
    return this.discovery;
  }

  async status(): Promise<OcrStatus> {
    const executable = await this.resolve();
    if (executable === null) {
      return {
        available: false,
        path: null,
        version: null,
        tessdataPath: this.configuredTessdata,
        languages: [],
        problem:
          'Tesseract is not installed. PaperForge reads scans with the local Tesseract program; install it, or point PaperForge at a copy in Settings.',
      };
    }

    try {
      const version = await this.run(['--version'], { executable });
      const languages = await this.languages(executable);
      return {
        available: languages.length > 0,
        path: executable,
        version: version.stdout.split('\n')[0]?.trim() ?? null,
        tessdataPath: this.configuredTessdata ?? (await this.defaultTessdata(executable)),
        languages,
        problem:
          languages.length > 0
            ? null
            : 'Tesseract is installed but has no language data. Point PaperForge at a tessdata folder in Settings.',
      };
    } catch (error) {
      return {
        available: false,
        path: executable,
        version: null,
        tessdataPath: this.configuredTessdata,
        languages: [],
        problem: AppError.serialize(error).message,
      };
    }
  }

  /** The language codes installed where Tesseract is looking. */
  async languages(executable?: string): Promise<string[]> {
    const binary = executable ?? (await this.resolve());
    if (binary === null) return [];

    try {
      const result = await this.run(['--list-langs'], { executable: binary });
      // The first line says where it looked; the rest are the codes.
      return `${result.stdout}\n${result.stderr}`
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => /^[A-Za-z0-9_+-]+$/.test(line) && !line.startsWith('List'));
    } catch {
      return [];
    }
  }

  /**
   * Reads one page image and says what it found.
   *
   * The picture is written to a file of PaperForge's own under the system
   * temporary folder, read by Tesseract, and deleted again — Tesseract reads
   * files, and a pipe would cost more than it saved.
   */
  async recognise(
    image: Uint8Array,
    options: OcrOptions,
    signal?: AbortSignal,
  ): Promise<ParsedPage> {
    const executable = await this.resolve();
    if (executable === null) {
      throw new AppError('sidecar/missing', {
        message: 'Tesseract is not installed.',
        details: 'Install it, or point PaperForge at a copy in Settings.',
      });
    }

    const directory = path.join(os.tmpdir(), 'PaperForge', 'ocr');
    await fs.mkdir(directory, { recursive: true });
    const imagePath = path.join(directory, `${randomUUID()}.png`);

    try {
      await fs.writeFile(imagePath, image);

      // Page segmentation mode 1 lets Tesseract work out which way up the page
      // is before reading it, which needs the orientation data; without that
      // data it is left to its own default rather than being asked for
      // something it cannot do.
      const orientable = (await this.installedLanguages(executable)).includes('osd');

      const result = await this.run(
        [
          imagePath,
          // A single dash writes the result to standard output.
          '-',
          '-l',
          options.languages.join('+'),
          '--dpi',
          String(options.dpi),
          ...(orientable ? ['--psm', '1'] : []),
          'tsv',
        ],
        { executable, ...(signal === undefined ? {} : { signal }) },
      );
      return parseTsv(result.stdout);
    } finally {
      await fs.rm(imagePath, { force: true }).catch(() => undefined);
    }
  }

  /** Runs Tesseract with the given arguments. Never goes through a shell. */
  private run(
    args: readonly string[],
    options: { executable: string; signal?: AbortSignal },
  ): Promise<{ stdout: string; stderr: string }> {
    const environment = { ...process.env };
    if (this.configuredTessdata !== null && this.configuredTessdata !== '') {
      environment['TESSDATA_PREFIX'] = this.configuredTessdata;
    }

    return new Promise((resolve, reject) => {
      const child = execFile(
        options.executable,
        [...args],
        {
          timeout: RUN_TIMEOUT_MS,
          maxBuffer: MAX_OUTPUT_BYTES,
          windowsHide: true,
          shell: false,
          env: environment,
        },
        (error, stdout, stderr) => {
          if (options.signal?.aborted === true) {
            reject(new AppError('op/cancelled', { details: 'recognition cancelled' }));
            return;
          }
          if (error === null) {
            resolve({ stdout, stderr });
            return;
          }

          reject(
            new AppError('ocr/failed', {
              message: 'Tesseract could not read that page.',
              details: `${error.message}${stderr === '' ? '' : `: ${stderr.slice(0, 500)}`}`,
              cause: error,
            }),
          );
        },
      );

      const abort = (): void => {
        child.kill();
      };
      options.signal?.addEventListener('abort', abort, { once: true });
      child.on('close', () => options.signal?.removeEventListener('abort', abort));
    });
  }

  /** The installed languages, asked for once and remembered. */
  private async installedLanguages(executable: string): Promise<string[]> {
    this.installed ??= this.languages(executable);
    return this.installed;
  }

  /** Where Tesseract looks for language data when nothing says otherwise. */
  private async defaultTessdata(executable: string): Promise<string | null> {
    const beside = path.join(path.dirname(executable), 'tessdata');
    return (await isDirectory(beside)) ? beside : (process.env['TESSDATA_PREFIX'] ?? null);
  }

  private async discover(): Promise<string | null> {
    const candidates: string[] = [];
    const configured = this.configuredPath?.trim();
    if (configured !== undefined && configured !== '') candidates.push(configured);

    // A staged copy inside the application comes first, so a packaged build
    // behaves the same on every machine.
    candidates.push(
      path.join(this.options.resourcesRoot, 'bundled-tools', 'tesseract', 'tesseract.exe'),
    );

    // Then where the Windows installer puts it.
    for (const root of [
      process.env['ProgramFiles'],
      process.env['ProgramFiles(x86)'],
      process.env['LOCALAPPDATA'] === undefined
        ? undefined
        : path.join(process.env['LOCALAPPDATA'], 'Programs'),
    ]) {
      if (root !== undefined) candidates.push(path.join(root, 'Tesseract-OCR', 'tesseract.exe'));
    }

    for (const candidate of candidates) {
      if (await isFile(candidate)) {
        this.options.logger.info('Found Tesseract.', candidate);
        return candidate;
      }
    }

    const fromPath = await this.findOnPath();
    if (fromPath !== null) this.options.logger.info('Found Tesseract on the PATH.', fromPath);
    else this.options.logger.info('Tesseract is not installed; scans cannot be read yet.');
    return fromPath;
  }

  private async findOnPath(): Promise<string | null> {
    const executableName = process.platform === 'win32' ? 'tesseract.exe' : 'tesseract';
    const entries = (process.env['PATH'] ?? '')
      .split(path.delimiter)
      .filter((entry) => entry !== '');

    for (const entry of entries) {
      const candidate = path.join(entry, executableName);
      if (await isFile(candidate)) return candidate;
    }
    return null;
  }
}

async function isFile(candidate: string): Promise<boolean> {
  try {
    return (await fs.stat(candidate)).isFile();
  } catch {
    return false;
  }
}

async function isDirectory(candidate: string): Promise<boolean> {
  try {
    return (await fs.stat(candidate)).isDirectory();
  } catch {
    return false;
  }
}
