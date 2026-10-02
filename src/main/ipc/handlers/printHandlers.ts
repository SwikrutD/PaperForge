import path from 'node:path';
import { AppError } from '@shared/errors/appError';
import type { DocumentService } from '../../services/documents/documentService';
import { listPrinters } from '../../services/printing/chromiumPrinter';
import type { PrintJobs } from '../../services/printing/printJobs';
import type { RegisterInvoke } from '../registry';

export interface PrintHandlerDeps {
  documents: DocumentService;
  printing: PrintJobs;
}

/**
 * Printing. The window draws the pages, because that is where PDF.js is, and
 * sends them here one at a time; this process lays them out and prints them.
 */
export function registerPrintHandlers(
  registerInvoke: RegisterInvoke,
  deps: PrintHandlerDeps,
): void {
  registerInvoke('print:printers', (_input, event) => listPrinters(event.sender));

  registerInvoke('print:start', async ({ sessionId, settings, pages }) => {
    const session = deps.documents.get(sessionId);
    if (session === undefined) {
      throw new AppError('print/failed', { message: 'That document is no longer open.' });
    }
    // The job's name in the Windows print queue.
    const title = path.basename(session.file.displayName, path.extname(session.file.displayName));
    return { printId: await deps.printing.start({ title, settings, pages }) };
  });

  registerInvoke('print:page', async (payload) => {
    await deps.printing.addPage(payload);
    return null;
  });

  registerInvoke('print:finish', ({ printId }) => deps.printing.finish(printId));

  registerInvoke('print:cancel', async ({ printId }) => {
    await deps.printing.cancel(printId);
    return null;
  });
}
