import { PDFDocument, degrees, type PDFPage } from 'pdf-lib';
import { AppError } from '@shared/errors/appError';
import type { EditOperation } from '@shared/schemas/edit';
import { normalizePages, rotationAfter } from './operations';
import type { DocumentFacts, MutationResult, PdfMutationEngine } from './types';

/**
 * The write engine, and the only file that imports pdf-lib.
 *
 * pdf-lib rewrites the whole file rather than appending an incremental update,
 * so every mutation produces a complete document. That is what makes a
 * revision a genuine snapshot, and it is why PaperForge does not claim
 * byte-level incremental saving (CLAUDE.md section 9).
 */
export class PdfLibMutationEngine implements PdfMutationEngine {
  async inspect(bytes: Uint8Array): Promise<DocumentFacts> {
    try {
      const document = await load(bytes);
      // Reading the page tree is where a file that only looks like a PDF
      // finally gives itself away, so it counts as part of the inspection.
      return { pageCount: document.getPageCount(), encrypted: false };
    } catch (error) {
      const failure = toMutationError(error);
      if (failure.code === 'pdf/unsupported-encryption') {
        return { pageCount: 0, encrypted: true };
      }
      throw failure;
    }
  }

  async apply(bytes: Uint8Array, operations: readonly EditOperation[]): Promise<MutationResult> {
    const document = await load(bytes);

    try {
      // pdf-lib's page cache is not invalidated when a page is removed, so
      // pages are held by identity and the running order is kept here rather
      // than asked for again.
      let order: PDFPage[] = document.getPages().slice();

      for (const operation of operations) {
        const targets = normalizePages(operation.pages, order.length).map(
          (pageNumber) => order[pageNumber - 1] as PDFPage,
        );

        if (operation.kind === 'rotatePages') {
          for (const page of targets) {
            page.setRotation(degrees(rotationAfter(page.getRotation().angle, operation.degrees)));
          }
          continue;
        }

        // Highest index first, so each removal leaves the lower ones alone.
        const doomed = new Set(targets);
        for (let index = order.length - 1; index >= 0; index -= 1) {
          if (doomed.has(order[index] as PDFPage)) document.removePage(index);
        }
        order = order.filter((page) => !doomed.has(page));
      }

      return { bytes: await save(document), pageCount: document.getPageCount() };
    } catch (error) {
      throw toMutationError(error);
    }
  }
}

async function load(bytes: Uint8Array): Promise<PDFDocument> {
  try {
    // The document's own metadata is left alone: PaperForge does not quietly
    // stamp itself as the producer of somebody else's file.
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (error) {
    throw toMutationError(error);
  }
}

async function save(document: PDFDocument): Promise<Uint8Array> {
  try {
    return await document.save({ useObjectStreams: true });
  } catch (error) {
    throw new AppError('io/write-failed', {
      message: 'The changed document could not be written.',
      details: messageOf(error),
      cause: error,
    });
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Turns a pdf-lib failure into PaperForge's typed error vocabulary. */
export function toMutationError(error: unknown): AppError {
  if (AppError.isAppError(error)) return error;
  const message = messageOf(error);
  const name = error instanceof Error ? error.name : '';

  if (name === 'EncryptedPDFError' || message.includes('is encrypted')) {
    return new AppError('pdf/unsupported-encryption', {
      message: 'PaperForge cannot change an encrypted document yet.',
      details: message,
      cause: error,
    });
  }
  return new AppError('pdf/malformed-content', {
    message: 'This document could not be changed because part of it is damaged.',
    details: message,
    cause: error,
  });
}
