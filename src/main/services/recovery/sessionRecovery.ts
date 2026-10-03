import fs from 'node:fs/promises';
import { AppError } from '@shared/errors/appError';
import type { DocumentEditState } from '@shared/schemas/edit';
import type { OpenFailure, OpenResult, RecoveryEntry } from '@shared/schemas/document';
import { writeFileAtomic } from '../filesystem/atomicWrite';
import type { Logger } from '../logging/logger';
import type { OpenOptions } from '../documents/documentService';
import type { SessionWorkspaces } from './recoveryJournal';

/** The label the recovered changes carry on Undo. */
export const RECOVERED_LABEL = 'Recovered unsaved changes';

/** The part of the document service recovery uses. */
export interface RecoveryDocuments {
  openPaths(paths: readonly string[], options?: OpenOptions): Promise<OpenResult>;
  activeSessionIds(): Set<string>;
}

/** The part of the editor recovery uses: making the recovered bytes the next revision. */
export interface RecoveryEditor {
  applyBytes(sessionId: string, label: string, bytes: Uint8Array): Promise<DocumentEditState>;
}

export interface SessionRecoveryDeps {
  workspaces: SessionWorkspaces;
  documents: RecoveryDocuments;
  editor: RecoveryEditor;
  logger: Logger;
}

/**
 * Brings back what a crash left behind.
 *
 * A session directory that outlives its process holds a journal and, when the
 * document had been changed, the revisions the editor wrote. Reopening opens
 * the file as it is on disk and then makes the last revision shown the next
 * one, so the reader gets their changes back — still unsaved, and undoable to
 * the file on disk. Nothing here writes to the reader's file.
 */
export class SessionRecovery {
  constructor(private readonly deps: SessionRecoveryDeps) {}

  list(): Promise<RecoveryEntry[]> {
    return this.deps.workspaces.listRecoverable(this.deps.documents.activeSessionIds());
  }

  /**
   * Reopens the documents of the given sessions, with their unsaved changes
   * where those were kept. A session whose changes could not be put back keeps
   * its directory, so the next start offers it again rather than losing it.
   */
  async restore(sessionIds: readonly string[]): Promise<OpenResult> {
    const result: OpenResult = { sessions: [], failures: [], canceled: false };

    for (const sessionId of sessionIds) {
      const journal = await this.deps.workspaces.read(sessionId);
      if (journal === undefined) continue;

      // Read the kept revision before anything else: the old directory is
      // removed once the document is open again.
      const copyPath = await this.deps.workspaces.unsavedCopyOf(journal);
      const recovered = copyPath === undefined ? undefined : await fs.readFile(copyPath);

      const opened = await this.deps.documents.openPaths([journal.path], {
        recordAsRecent: false,
      });
      result.failures.push(...opened.failures);
      const session = opened.sessions[0];
      if (session === undefined) continue;

      if (recovered !== undefined) {
        try {
          await this.deps.editor.applyBytes(session.id, RECOVERED_LABEL, recovered);
        } catch (error) {
          this.deps.logger.warn('Unsaved changes could not be reapplied.', journal.displayName);
          result.failures.push(failureFor(journal.path, error));
          result.sessions.push(session);
          continue;
        }
      }

      result.sessions.push(session);
      await this.deps.workspaces.remove(sessionId);
    }

    return result;
  }

  /**
   * Writes the unsaved changes of a session whose file has gone to a new
   * place, and opens that. The new file is the recovered document; it has no
   * history to undo to.
   */
  async saveCopy(sessionId: string, destination: string): Promise<OpenResult> {
    const journal = await this.deps.workspaces.read(sessionId);
    const copyPath =
      journal === undefined ? undefined : await this.deps.workspaces.unsavedCopyOf(journal);
    if (journal === undefined || copyPath === undefined) {
      throw new AppError('io/not-found', {
        message: 'Those unsaved changes are no longer available.',
        details: `session ${sessionId}`,
      });
    }

    await writeFileAtomic(destination, await fs.readFile(copyPath));
    const opened = await this.deps.documents.openPaths([destination]);
    if (opened.sessions.length > 0) await this.deps.workspaces.remove(sessionId);
    this.deps.logger.info('Saved recovered changes to a new file.', journal.displayName);
    return opened;
  }

  async discard(sessionIds: readonly string[]): Promise<RecoveryEntry[]> {
    for (const sessionId of sessionIds) await this.deps.workspaces.remove(sessionId);
    return this.list();
  }
}

function failureFor(filePath: string, error: unknown): OpenFailure {
  const serialized = AppError.serialize(error);
  return {
    path: filePath,
    code: serialized.code,
    message: 'The document was reopened, but its unsaved changes could not be put back.',
    details: serialized.message,
  };
}
