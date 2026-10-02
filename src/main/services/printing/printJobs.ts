import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '@shared/errors/appError';
import type { PrintOutcome, PrintPagePayload, PrintSettings } from '@shared/schemas/print';
import type { Logger } from '../logging/logger';
import {
  buildPrintDocument,
  resolveLandscape,
  toPrintOptions,
  type PrintSheet,
} from './printDocument';

/** Hands a laid-out print document to the printer. */
export type PrintDriver = (input: {
  documentPath: string;
  directory: string;
  options: Electron.WebContentsPrintOptions;
}) => Promise<{ printed: boolean }>;

export interface PrintJobsOptions {
  /** Where print jobs keep their pages until they are printed. */
  root: string;
  driver: PrintDriver;
  logger: Logger;
}

interface PrintJob {
  id: string;
  directory: string;
  title: string;
  settings: PrintSettings;
  expected: number;
  sheets: PrintSheet[];
}

/**
 * Print jobs, from the first page to the printer.
 *
 * The window sends one drawn page at a time and each is written to the job's
 * own folder at once, so a long document never sits in memory as pictures.
 * The folder is removed when the job is printed, dismissed or stopped, and
 * whatever an earlier run left behind is cleared when PaperForge starts.
 */
export class PrintJobs {
  private readonly jobs = new Map<string, PrintJob>();

  constructor(private readonly options: PrintJobsOptions) {}

  /** Removes the folders of jobs a previous run did not finish. */
  async clearStale(): Promise<void> {
    await fs.rm(this.options.root, { recursive: true, force: true }).catch(() => undefined);
  }

  async start(input: { title: string; settings: PrintSettings; pages: number }): Promise<string> {
    const id = randomUUID();
    const directory = path.join(this.options.root, id);
    await fs.mkdir(directory, { recursive: true });
    this.jobs.set(id, {
      id,
      directory,
      title: input.title,
      settings: input.settings,
      expected: input.pages,
      sheets: [],
    });
    return id;
  }

  async addPage(payload: PrintPagePayload): Promise<void> {
    const job = this.get(payload.printId);
    if (job.sheets.length >= job.expected) {
      throw new AppError('print/failed', { details: 'More pages arrived than the job expected.' });
    }

    const file = `page-${String(job.sheets.length + 1).padStart(5, '0')}.png`;
    const bytes = Buffer.from(payload.image, 'base64');
    if (!isPng(bytes)) {
      throw new AppError('print/failed', { details: 'A page did not arrive as a PNG picture.' });
    }
    await fs.writeFile(path.join(job.directory, file), bytes);
    job.sheets.push({ file, width: payload.width, height: payload.height });
  }

  async finish(printId: string): Promise<PrintOutcome> {
    const job = this.get(printId);
    this.jobs.delete(printId);

    try {
      if (job.sheets.length === 0) {
        throw new AppError('print/failed', { details: 'The job had no pages.' });
      }
      const documentPath = path.join(job.directory, 'print.html');
      await fs.writeFile(
        documentPath,
        buildPrintDocument({ title: job.title, sheets: job.sheets, settings: job.settings }),
        'utf8',
      );

      const landscape = resolveLandscape(job.settings.orientation, job.sheets);
      const { printed } = await this.options.driver({
        documentPath,
        directory: job.directory,
        options: toPrintOptions(job.settings, landscape),
      });
      this.options.logger.info(
        printed ? 'Sent a document to the printer.' : 'The print dialog was dismissed.',
        `${String(job.sheets.length)} sheets`,
      );
      return { printed, sheets: printed ? job.sheets.length : 0 };
    } finally {
      await this.remove(job);
    }
  }

  async cancel(printId: string): Promise<void> {
    const job = this.jobs.get(printId);
    if (job === undefined) return;
    this.jobs.delete(printId);
    await this.remove(job);
  }

  private get(printId: string): PrintJob {
    const job = this.jobs.get(printId);
    if (job === undefined) {
      throw new AppError('print/failed', { details: 'That print job is no longer running.' });
    }
    return job;
  }

  private async remove(job: PrintJob): Promise<void> {
    try {
      await fs.rm(job.directory, { recursive: true, force: true });
    } catch (error) {
      this.options.logger.warn('A print job folder could not be removed.', error);
    }
  }
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function isPng(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((value, index) => bytes[index] === value);
}
