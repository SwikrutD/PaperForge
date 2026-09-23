import { PDFName, type PDFDocument } from 'pdf-lib';
import { AppError } from '@shared/errors/appError';
import type { EditOperation } from '@shared/schemas/edit';
import { readPageContent, type PageContent } from '@pdf/content/pageContent';
import { rewriteRunText } from '@pdf/content/editText';
import type { TextRun } from '@pdf/content/textRuns';

/**
 * Changing the text a page draws.
 *
 * The run to change is named by the operation it came from, which is stable
 * for as long as the content is: every change produces a new revision, the
 * page is read again, and the ids are handed out again with it.
 */

/** How a run is named outside this process. */
export function runIdOf(run: TextRun): string {
  return `op${String(run.operationIndex)}`;
}

export function findRun(content: PageContent, runId: string): TextRun | undefined {
  return content.runs.find((run) => runIdOf(run) === runId);
}

/** Replaces a page's content with the bytes given, as a single stream. */
export function setPageContent(document: PDFDocument, pageIndex: number, bytes: Uint8Array): void {
  const page = document.getPage(pageIndex);
  // A single uncompressed stream: what PaperForge writes it can read back,
  // and the optimizer compresses a document when the reader asks it to.
  const stream = document.context.stream(bytes);
  const ref = document.context.register(stream);
  page.node.set(PDFName.of('Contents'), ref);
}

/** Applies a text operation; returns false when it is not one. */
export async function applyTextOperation(
  document: PDFDocument,
  operation: EditOperation,
): Promise<boolean> {
  if (operation.kind !== 'editText') return false;

  const pageIndex = operation.page - 1;
  if (pageIndex < 0 || pageIndex >= document.getPageCount()) {
    throw new AppError('internal/unexpected', {
      message: 'That page is not in this document any more.',
      details: `page ${String(operation.page)} of ${String(document.getPageCount())}`,
    });
  }

  const content = await readPageContent(document, pageIndex);
  const run = findRun(content, operation.runId);
  if (run === undefined) {
    throw new AppError('pdf/malformed-content', {
      message: 'That text is no longer where it was; close the editor and try again.',
      details: `run ${operation.runId} on page ${String(operation.page)}`,
    });
  }

  const result = rewriteRunText(content.bytes, run, operation.text);
  if (!result.ok) {
    throw new AppError('pdf/malformed-content', {
      message:
        result.reason === 'no-font'
          ? 'PaperForge cannot tell which font drew that text, so it cannot rewrite it.'
          : `The font this text is drawn in cannot write “${result.character ?? '?'}”.`,
      details: `run ${operation.runId} on page ${String(operation.page)}`,
    });
  }

  setPageContent(document, pageIndex, result.bytes);
  return true;
}
