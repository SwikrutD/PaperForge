import { PDFDocument } from 'pdf-lib';
import { AppError } from '@shared/errors/appError';
import type { PageLinksModel } from '@shared/schemas/link';
import { linksOnPage } from '@pdf/mutate/links';
import type { DocumentEditor } from '../../services/documents/documentEditor';
import type { RegisterInvoke } from '../registry';

export interface LinkHandlerDeps {
  editor: DocumentEditor;
}

/**
 * The links a page carries.
 *
 * Read from the revision being shown, like the text and the images: a link's
 * name holds for as long as the link does, and pointing one somewhere else
 * replaces it.
 */
export function registerLinkHandlers(registerInvoke: RegisterInvoke, deps: LinkHandlerDeps): void {
  registerInvoke('links:page', async ({ sessionId, page }) => {
    const bytes = await deps.editor.currentBytes(sessionId);

    let document: PDFDocument;
    try {
      document = await PDFDocument.load(bytes, { updateMetadata: false });
    } catch (error) {
      throw new AppError('pdf/invalid', {
        message: 'That document could not be read for editing.',
        cause: error,
      });
    }

    if (page < 1 || page > document.getPageCount()) {
      throw new AppError('internal/unexpected', {
        message: 'That page is not in this document.',
        details: `page ${String(page)} of ${String(document.getPageCount())}`,
      });
    }

    const model: PageLinksModel = {
      page,
      revision: deps.editor.revisionOf(sessionId),
      links: linksOnPage(document, page - 1),
    };
    return model;
  });
}
