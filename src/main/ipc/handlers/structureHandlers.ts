import { AppError } from '@shared/errors/appError';
import { readSecuritySummary } from '@pdf/security/summary';
import type { PdfMutationEngine } from '@pdf/mutate/types';
import type { DocumentEditor } from '../../services/documents/documentEditor';
import type { RegisterInvoke } from '../registry';

export interface StructureHandlerDeps {
  editor: DocumentEditor;
  engine: PdfMutationEngine;
}

/**
 * What a document says about its own structure: the tags the Accessibility
 * Check reads, and the order they put a page in.
 *
 * Every reading is of the revision the reader is looking at and carries that
 * revision, so the window can tell a stale one from a current one.
 */
export function registerStructureHandlers(
  registerInvoke: RegisterInvoke,
  deps: StructureHandlerDeps,
): void {
  registerInvoke('accessibility:check', async ({ sessionId }) => {
    const bytes = await deps.editor.currentBytes(sessionId);
    const revision = deps.editor.revisionOf(sessionId);
    const report = await deps.engine.checkAccessibility(bytes, readSecuritySummary(bytes));
    return { ...report, revision };
  });

  /**
   * The outline as the bookmark operations address it. A document the write
   * engine cannot open — an encrypted one — has bookmarks that can be read in
   * the viewer but not changed, which is what `editable` says.
   */
  registerInvoke('bookmarks:list', async ({ sessionId }) => {
    const bytes = await deps.editor.currentBytes(sessionId);
    const revision = deps.editor.revisionOf(sessionId);
    try {
      return { revision, editable: true, bookmarks: await deps.engine.readBookmarks(bytes) };
    } catch (error) {
      if (AppError.isAppError(error) && error.code === 'pdf/unsupported-encryption') {
        return { revision, editable: false, bookmarks: [] };
      }
      throw error;
    }
  });

  registerInvoke('accessibility:readingOrder', async ({ sessionId, page }) => {
    const bytes = await deps.editor.currentBytes(sessionId);
    const revision = deps.editor.revisionOf(sessionId);
    return { ...(await deps.engine.readReadingOrder(bytes, page)), revision };
  });
}
