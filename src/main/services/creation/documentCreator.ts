import { AppError } from '@shared/errors/appError';
import type { BlankRequest, CombineRequest, CreateOutcome } from '@shared/schemas/create';
import { combineDocuments, type CombinePart } from '@pdf/create/combine';
import { createBlank } from '@pdf/create/documents';
import { resolveSize } from '@pdf/create/paper';
import type { PdfMutationEngine } from '@pdf/mutate/types';
import { publishDocument } from '../documents/publishDocument';
import type { QpdfService } from '../qpdf/qpdfService';
import type { Logger } from '../logging/logger';
import type { SourceLibrary } from './sourceLibrary';

/**
 * Making the document the reader asked for and putting it on disk.
 *
 * Nothing here opens a source file for writing: pages are copied into a new
 * document, and that document is published through the same write-validate-
 * rename pipeline a save uses, so a file only appears once it can be reopened.
 */
export interface DocumentCreatorDeps {
  library: SourceLibrary;
  engine: PdfMutationEngine;
  qpdf: QpdfService;
  logger: Logger;
}

export class DocumentCreator {
  constructor(private readonly deps: DocumentCreatorDeps) {}

  async blank(request: BlankRequest, targetPath: string): Promise<CreateOutcome> {
    const size = resolveSize(request.size) ?? { width: 595.28, height: 841.89 };
    const bytes = await createBlank({
      size,
      pageCount: request.pageCount,
      metadata: request.metadata,
    });

    await publishDocument(this.deps, bytes, targetPath);
    this.deps.logger.info(
      'Created a blank document.',
      targetPath,
      `${String(request.pageCount)}pp`,
    );
    return { canceled: false, path: targetPath, pageCount: request.pageCount };
  }

  async combine(
    ownerId: number,
    request: CombineRequest,
    targetPath: string,
  ): Promise<CreateOutcome> {
    const parts: CombinePart[] = request.entries.map((entry) => {
      const source = this.deps.library.get(ownerId, entry.id);
      if (source === undefined) {
        throw new AppError('internal/unexpected', {
          message: 'One of those files is no longer staged. Add it again.',
          details: entry.id,
        });
      }
      return {
        bytes: source.bytes,
        pages: entry.pages,
        rotation: entry.rotation,
        title: source.fileName.replace(/\.[^.]+$/, ''),
      };
    });

    const result = await combineDocuments(parts, {
      bookmarkPerSource: request.bookmarkPerSource,
      keepBookmarks: request.keepBookmarks,
      metadata: request.metadata,
    });

    await publishDocument(this.deps, result.bytes, targetPath);
    this.deps.logger.info(
      'Combined documents.',
      targetPath,
      `${String(parts.length)} sources, ${String(result.pageCount)}pp`,
    );
    return { canceled: false, path: targetPath, pageCount: result.pageCount };
  }
}
