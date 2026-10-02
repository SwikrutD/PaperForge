import type { PdfMutationEngine } from '@pdf/mutate/types';
import type { DocumentEditor } from '../../services/documents/documentEditor';
import type { StagedAssets } from '../../services/documents/stagedAssets';
import type { RegisterInvoke } from '../registry';

export interface RedactionHandlerDeps {
  editor: DocumentEditor;
  engine: PdfMutationEngine;
  stagedAssets: StagedAssets;
}

/**
 * Finding, planning and preparing redactions.
 *
 * Everything is read from the revision being shown, and says which revision
 * that was: a mark placed on one revision means nothing on another. Applying
 * goes through the ordinary edit pipeline, so it is one undoable step until
 * the document is saved.
 */
export function registerRedactionHandlers(
  registerInvoke: RegisterInvoke,
  deps: RedactionHandlerDeps,
): void {
  registerInvoke('redaction:find', async ({ sessionId, search }) => {
    const revision = deps.editor.revisionOf(sessionId);
    const bytes = await deps.editor.currentBytes(sessionId);
    return { revision, ...(await deps.engine.findForRedaction(bytes, search)) };
  });

  registerInvoke('redaction:plan', async ({ sessionId, marks }) => {
    const revision = deps.editor.revisionOf(sessionId);
    const bytes = await deps.editor.currentBytes(sessionId);
    return { revision, ...(await deps.engine.planRedactions(bytes, marks)) };
  });

  registerInvoke('redaction:stagePage', ({ sessionId, page, image }) => {
    const bytes = new Uint8Array(Buffer.from(image, 'base64'));
    const staged = deps.stagedAssets.stageImageBytes(sessionId, bytes, `page ${String(page)}`);
    return { token: staged.token };
  });
}
