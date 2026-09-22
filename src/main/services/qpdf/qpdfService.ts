import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '@shared/errors/appError';
import type { QpdfStatus } from '@shared/schemas/edit';
import type { Logger } from '../logging/logger';

/** Long enough for a large document, short enough not to hang a save. */
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_BYTES = 1024 * 1024;

export interface QpdfRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface QpdfCheckResult {
  /** True when qpdf found nothing wrong at all. */
  ok: boolean;
  /**
   * True when qpdf could read the file. Exit code 3 means warnings only, which
   * is common in perfectly usable PDFs and is not a reason to refuse a save.
   */
  readable: boolean;
  output: string;
}

export interface QpdfServiceOptions {
  logger: Logger;
  /** Where the application keeps its bundled sidecars, when it has any. */
  resourcesRoot: string;
  /** A path the reader configured, which wins over discovery. */
  configuredPath?: string | null;
}

/**
 * Runs the local qpdf binary, if there is one.
 *
 * qpdf is optional: PaperForge validates its own output by reopening it, and
 * uses qpdf as a second opinion when it is installed. Nothing here downloads
 * anything, the binary is only ever launched by this main-process wrapper,
 * arguments are passed as an array with no shell involved, and a cancelled run
 * kills the child process.
 */
export class QpdfService {
  private discovery: Promise<string | null> | undefined;
  private configuredPath: string | null;

  constructor(private readonly options: QpdfServiceOptions) {
    this.configuredPath = options.configuredPath ?? null;
  }

  /** Points the service at a different executable and looks again. */
  setConfiguredPath(qpdfPath: string | null): void {
    if (this.configuredPath === qpdfPath) return;
    this.configuredPath = qpdfPath;
    this.discovery = undefined;
  }

  /** The executable to run, or null when qpdf is not installed. */
  async resolve(): Promise<string | null> {
    this.discovery ??= this.discover();
    return this.discovery;
  }

  async status(): Promise<QpdfStatus> {
    const executable = await this.resolve();
    if (executable === null) {
      return {
        available: false,
        path: null,
        version: null,
        problem:
          'Not found. PaperForge saves without it and checks its own work; with qpdf, saved files are inspected a second time before they replace yours.',
      };
    }

    try {
      const result = await this.run(['--version'], { executable });
      const version = result.stdout.split('\n')[0]?.trim() ?? null;
      return { available: true, path: executable, version, problem: null };
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
   * Asks qpdf whether a file is structurally sound. Returns undefined when
   * qpdf is not installed, which is not an error.
   */
  async check(filePath: string, signal?: AbortSignal): Promise<QpdfCheckResult | undefined> {
    const executable = await this.resolve();
    if (executable === null) return undefined;

    try {
      const result = await this.run(['--check', filePath], {
        executable,
        ...(signal && { signal }),
      });
      return { ok: true, readable: true, output: result.stdout || result.stderr };
    } catch (error) {
      if (error instanceof QpdfExitError) {
        // 0 is clean, 3 is warnings only; anything else means qpdf could not
        // make sense of the file.
        const warningsOnly = error.exitCode === 3;
        return {
          ok: false,
          readable: warningsOnly,
          output: `${error.stdout}\n${error.stderr}`.trim(),
        };
      }
      throw error;
    }
  }

  /** Runs qpdf with the given arguments. Never goes through a shell. */
  async run(
    args: readonly string[],
    options: { executable?: string; signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<QpdfRunResult> {
    const executable = options.executable ?? (await this.resolve());
    if (executable === null) {
      throw new AppError('sidecar/missing', {
        message: 'qpdf is not installed.',
        details: 'Set its location in Settings, or install it and restart PaperForge.',
      });
    }

    return new Promise<QpdfRunResult>((resolve, reject) => {
      const child = execFile(
        executable,
        [...args],
        {
          timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          maxBuffer: MAX_OUTPUT_BYTES,
          windowsHide: true,
          // No shell: arguments are passed through as given, so a path with
          // spaces, quotes or non-ASCII characters needs no escaping.
          shell: false,
        },
        (error, stdout, stderr) => {
          if (options.signal?.aborted === true) {
            reject(new AppError('op/cancelled', { details: 'qpdf run cancelled' }));
            return;
          }
          if (error === null) {
            resolve({ exitCode: 0, stdout, stderr });
            return;
          }

          const exitCode = typeof error.code === 'number' ? error.code : -1;
          if (exitCode > 0) {
            reject(new QpdfExitError(exitCode, stdout, stderr));
            return;
          }
          reject(
            new AppError('sidecar/missing', {
              message: 'qpdf could not be run.',
              details: `${error.message}${stderr ? `: ${stderr.slice(0, 500)}` : ''}`,
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

  private async discover(): Promise<string | null> {
    const candidates: string[] = [];
    const configured = this.configuredPath?.trim();
    if (configured !== undefined && configured !== '') candidates.push(configured);

    // A staged copy inside the application takes precedence over the system
    // one, so a packaged build behaves the same on every machine.
    candidates.push(
      path.join(this.options.resourcesRoot, 'bundled-tools', 'qpdf', 'bin', 'qpdf.exe'),
    );
    candidates.push(path.join(this.options.resourcesRoot, 'bundled-tools', 'qpdf', 'qpdf.exe'));

    for (const candidate of candidates) {
      if (await isExecutableFile(candidate)) {
        this.options.logger.info('Found qpdf.', candidate);
        return candidate;
      }
    }

    // Finally the PATH, which is how a normal qpdf installation is reached.
    const fromPath = await this.findOnPath();
    if (fromPath !== null) this.options.logger.info('Found qpdf on the PATH.', fromPath);
    else
      this.options.logger.info('qpdf is not installed; saved files will not be checked with it.');
    return fromPath;
  }

  private async findOnPath(): Promise<string | null> {
    const executableName = process.platform === 'win32' ? 'qpdf.exe' : 'qpdf';
    const entries = (process.env['PATH'] ?? '')
      .split(path.delimiter)
      .filter((entry) => entry !== '');

    for (const entry of entries) {
      const candidate = path.join(entry, executableName);
      if (await isExecutableFile(candidate)) return candidate;
    }
    return null;
  }
}

/** qpdf ran and refused the file; the exit code says how badly. */
export class QpdfExitError extends Error {
  constructor(
    readonly exitCode: number,
    readonly stdout: string,
    readonly stderr: string,
  ) {
    super(`qpdf exited with ${exitCode}`);
    this.name = 'QpdfExitError';
  }
}

async function isExecutableFile(candidate: string): Promise<boolean> {
  try {
    const stats = await fs.stat(candidate);
    return stats.isFile();
  } catch {
    return false;
  }
}
