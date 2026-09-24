import { PDFDocument } from 'pdf-lib';
import { AppError } from '@shared/errors/appError';
import type { FormModel } from '@shared/schemas/form';
import { hasDocumentScript, needsAppearances, readFormFields } from '@pdf/forms/read';
import type { DocumentEditor } from '../../services/documents/documentEditor';
import type { RegisterInvoke } from '../registry';

export interface FormHandlerDeps {
  editor: DocumentEditor;
}

/**
 * The form a document carries.
 *
 * Read whole rather than page by page: a field can be drawn on several pages,
 * and a form is small compared with the document it sits on. The model
 * carries the revision it came from, so a stale one can be spotted.
 */
export function registerFormHandlers(registerInvoke: RegisterInvoke, deps: FormHandlerDeps): void {
  registerInvoke('forms:model', async ({ sessionId }) => {
    const bytes = await deps.editor.currentBytes(sessionId);

    let document: PDFDocument;
    try {
      document = await PDFDocument.load(bytes, { updateMetadata: false });
    } catch (error) {
      throw new AppError('pdf/invalid', {
        message: 'That document could not be read for filling in.',
        cause: error,
      });
    }

    const model: FormModel = {
      revision: deps.editor.revisionOf(sessionId),
      fields: readFormFields(document),
      hasDocumentScript: hasDocumentScript(document),
      needsAppearances: needsAppearances(document),
    };
    return model;
  });
}
