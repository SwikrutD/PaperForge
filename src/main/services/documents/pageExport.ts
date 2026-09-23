import path from 'node:path';
import { AppError } from '@shared/errors/appError';
import type { ExportResult, SplitPart } from '@shared/schemas/pages';
import { extractPages } from '@pdf/mutate/extract';
import type { PdfMutationEngine } from '@pdf/mutate/types';
import { publishDocument } from './publishDocument';
import type { Logger } from '../logging/logger';
import type { QpdfService } from '../qpdf/qpdfService';

export interface PageExportDeps {
  engine: PdfMutationEngine;
  qpdf: QpdfService;
  logger: Logger;
}

export interface ExportJob {
  /** The document being taken from. */
  bytes: Uint8Array;
  /** Name of the file the pages came from, for naming what is written. */
  sourceName: string;
  parts: readonly SplitPart[];
  /** Folder for several files, or the exact file for a single one. */
  destination: { kind: 'file'; path: string } | { kind: 'directory'; path: string };
}

/**
 * Writing pages out as new documents: extraction and splitting.
 *
 * Nothing here changes the document the pages came from — the pages are copied
 * into a new document and written through the same safe pipeline a save uses,
 * so a file is only published once it has been read back.
 */
export class PageExport {
  constructor(private readonly deps: PageExportDeps) {}

  async run(job: ExportJob): Promise<ExportResult> {
    const written: string[] = [];

    try {
      for (const [index, part] of job.parts.entries()) {
        const target =
          job.destination.kind === 'file'
            ? job.destination.path
            : path.join(job.destination.path, uniqueName(safeFileName(part.name), written));

        const bytes = await extractPages(job.bytes, part.pages);
        // The same rule as a save: a file PaperForge cannot read back is never
        // published.
        await publishDocument(this.deps, bytes, target);

        written.push(target);
        this.deps.logger.info('Wrote pages to a new document.', target, `part ${index + 1}`);
      }
    } catch (error) {
      // Whatever was written before the failure stays; the reader is told how
      // far it got rather than being left guessing.
      throw new AppError('io/write-failed', {
        message:
          written.length === 0
            ? 'Those pages could not be written.'
            : `Only ${String(written.length)} of ${String(job.parts.length)} files were written.`,
        details: AppError.serialize(error).message,
        cause: error,
      });
    }

    return {
      canceled: false,
      paths: written,
      directory:
        job.destination.kind === 'directory'
          ? job.destination.path
          : path.dirname(job.destination.path),
    };
  }
}

/** A file name that does not collide with one this run already wrote. */
function uniqueName(name: string, written: readonly string[]): string {
  const taken = new Set(written.map((entry) => path.basename(entry).toLowerCase()));
  const extension = path.extname(name) === '' ? '.pdf' : path.extname(name);
  const stem = path.basename(name, path.extname(name));

  let candidate = `${stem}${extension}`;
  let counter = 2;
  while (taken.has(candidate.toLowerCase())) {
    candidate = `${stem} (${String(counter)})${extension}`;
    counter += 1;
  }
  return candidate;
}

/**
 * A name suggested by the renderer, reduced to something safe to join onto a
 * folder the reader chose.
 *
 * Only a file name survives: no directory parts, none of the characters
 * Windows forbids, and always a `.pdf` extension.
 */
export function safeFileName(name: string): string {
  // The last segment only: anything that looks like a folder is dropped
  // rather than flattened, so a suggestion cannot climb out of the folder
  // the reader chose.
  const last = name.split(/[\\/]/).pop() ?? '';
  const stem = last
    .replace(/\.pdf$/i, '')
    // Everything Windows forbids in a file name, plus control characters.
    .replace(/[<>:"|?*]|\p{Cc}/gu, '-')
    .replace(/^[.\s]+/, '')
    .replace(/[.\s]+$/, '')
    .slice(0, 120)
    .trim();

  return `${stem === '' ? 'pages' : stem}.pdf`;
}
