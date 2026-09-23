import fs from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '@shared/errors/appError';
import type { PdfMutationEngine } from '@pdf/mutate/types';
import { writeFileAtomic } from '../filesystem/atomicWrite';
import type { QpdfService } from '../qpdf/qpdfService';

/**
 * Putting a document PaperForge produced on disk.
 *
 * The same rule everywhere a file is written: a temporary sibling, flushed,
 * reopened through the engine — and inspected by qpdf when it is installed —
 * before it replaces anything. A file PaperForge cannot read back is never
 * published, so a failed write leaves whatever was there untouched.
 */
export interface PublishDeps {
  engine: PdfMutationEngine;
  qpdf: QpdfService;
}

export async function publishDocument(
  deps: PublishDeps,
  bytes: Uint8Array,
  targetPath: string,
): Promise<void> {
  const displayName = path.basename(targetPath);
  await writeFileAtomic(targetPath, bytes, {
    validate: async (tempPath) => {
      const written = new Uint8Array(await fs.readFile(tempPath));
      const facts = await deps.engine.inspect(written);
      if (facts.pageCount < 1) {
        throw new AppError('io/write-failed', {
          message: `${displayName} was not written: the file PaperForge produced could not be reopened.`,
        });
      }

      const check = await deps.qpdf.check(tempPath).catch(() => undefined);
      if (check !== undefined && !check.readable) {
        throw new AppError('io/write-failed', {
          message: `${displayName} was not written: qpdf could not read the file PaperForge produced.`,
          details: check.output.slice(0, 2000),
        });
      }
    },
  });
}
