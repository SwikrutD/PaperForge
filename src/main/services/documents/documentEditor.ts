import fs from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '@shared/errors/appError';
import type {
  DocumentEditState,
  EditTransaction,
  SaveMode,
  SaveOutcome,
} from '@shared/schemas/edit';
import type { DocumentSession } from '@shared/schemas/document';
import type { Annotation } from '@shared/schemas/annotation';
import { validateTransaction } from '@pdf/mutate/operations';
import type { PdfMutationEngine, StagedAsset } from '@pdf/mutate/types';
import { writeFileAtomic } from '../filesystem/atomicWrite';
import type { Logger } from '../logging/logger';
import type { QpdfService } from '../qpdf/qpdfService';
import type { EditJournalState } from './documentService';
import { RevisionHistory } from './revisionHistory';

const REVISIONS_DIR_NAME = 'revisions';

/**
 * The part of the document service the editor uses. Naming it keeps the editor
 * testable without an Electron session, and says exactly what it may touch.
 */
export interface EditorDocuments {
  get(sessionId: string): DocumentSession | undefined;
  /** Points a session at a new file, after Save As. */
  retarget(sessionId: string, filePath: string): Promise<DocumentSession>;
  /** Re-reads the file PaperForge has just written itself. */
  markSavedByUs(sessionId: string): Promise<DocumentSession>;
}

export interface DocumentEditorDeps {
  documents: EditorDocuments;
  engine: PdfMutationEngine;
  qpdf: QpdfService;
  logger: Logger;
  /** The working directory PaperForge owns for a session. */
  workspaceDirectory: (sessionId: string) => string;
  /**
   * Records unsaved changes, and the revision holding them, in the recovery
   * journal.
   */
  recordState: (sessionId: string, state: EditJournalState) => Promise<void>;
  /** Files staged for this session, which a change may need to embed. */
  stagedAssets: (sessionId: string) => ReadonlyMap<string, StagedAsset>;
}

interface EditedDocument {
  history: RevisionHistory;
  /** Annotations of the revision being shown, read once and kept. */
  annotations?: { revision: number; list: Annotation[] };
  /**
   * The revision whose bytes are on disk. The document is dirty exactly when
   * the current revision is a different one.
   */
  savedRevision: number;
  savedAt: string | null;
}

export interface SaveRequest {
  sessionId: string;
  mode: SaveMode;
  /** Where to write. Required for Save As and Save a Copy. */
  destination?: string | undefined;
  /** Save anyway, after the reader was told the file changed underneath. */
  force?: boolean | undefined;
}

/**
 * Applies changes to a document, remembers how to take them back, and writes
 * the result out safely.
 *
 * Nothing is written to the reader's file until they ask for it: a change
 * produces a new revision inside the session's own working directory, and the
 * viewer is pointed at that file instead of the original. Saving copies the
 * current revision over the destination through a temporary file that is
 * reopened — and checked with qpdf when it is installed — before it replaces
 * anything.
 */
export class DocumentEditor {
  private readonly edited = new Map<string, EditedDocument>();

  constructor(private readonly deps: DocumentEditorDeps) {}

  /** The bytes of the revision being shown, for reading pages out of it. */
  async currentBytes(sessionId: string): Promise<Uint8Array> {
    return this.readCurrentBytes(this.requireSession(sessionId));
  }

  /** Which revision is being shown, which every model read from it belongs to. */
  revisionOf(sessionId: string): number {
    return this.edited.get(sessionId)?.history.currentRevision ?? 0;
  }

  /** The file the viewer should read: the current revision, or the original. */
  currentBytesPath(sessionId: string): string | undefined {
    return this.edited.get(sessionId)?.history.current?.filePath;
  }

  /**
   * The file holding one revision's bytes, for a viewer still showing it while
   * the next one loads. Null when that revision is no longer kept.
   */
  revisionBytesPath(sessionId: string, revision: number): string | null {
    const session = this.requireSession(sessionId);
    const history = this.edited.get(sessionId)?.history;
    if (history === undefined) return revision === 0 ? session.file.path : null;
    return history.find(revision)?.filePath ?? null;
  }

  state(sessionId: string): DocumentEditState {
    const session = this.requireSession(sessionId);
    const entry = this.edited.get(sessionId);

    if (entry === undefined) {
      return {
        sessionId: session.id,
        revision: 0,
        dirty: false,
        canUndo: false,
        canRedo: false,
        undoLabel: null,
        redoLabel: null,
        savedAt: null,
        historyTrimmed: false,
      };
    }

    const { history } = entry;
    return {
      sessionId: session.id,
      revision: history.currentRevision,
      dirty: history.currentRevision !== entry.savedRevision,
      canUndo: history.canUndo,
      canRedo: history.canRedo,
      undoLabel: history.undoLabel,
      redoLabel: history.redoLabel,
      savedAt: entry.savedAt,
      historyTrimmed: history.trimmed,
    };
  }

  async apply(sessionId: string, transaction: EditTransaction): Promise<DocumentEditState> {
    const session = this.requireSession(sessionId);
    const bytes = await this.readCurrentBytes(session);

    const facts = await this.deps.engine.inspect(bytes);
    if (facts.encrypted) {
      throw new AppError('pdf/unsupported-encryption', {
        message: 'PaperForge cannot change an encrypted document yet.',
        details: 'Removing the password needs the qpdf-based security tools.',
      });
    }

    const { operations } = validateTransaction(transaction, facts.pageCount);
    const entry = await this.ensureStarted(sessionId, bytes);
    const result = await this.deps.engine.apply(
      bytes,
      operations,
      this.deps.stagedAssets(sessionId),
    );

    delete entry.annotations;
    await entry.history.push(transaction.label, result.bytes);
    await this.recordState(sessionId);
    this.deps.logger.info('Applied a change.', session.file.displayName, transaction.label);
    return this.state(sessionId);
  }

  /**
   * Makes a whole document produced elsewhere — by qpdf, say — the next
   * revision. It is checked the way a save is: bytes PaperForge cannot read
   * back never become the document being shown.
   */
  async applyBytes(
    sessionId: string,
    label: string,
    bytes: Uint8Array,
  ): Promise<DocumentEditState> {
    const session = this.requireSession(sessionId);
    const facts = await this.deps.engine.inspect(bytes);
    if (facts.encrypted || facts.pageCount < 1) {
      throw new AppError('io/write-failed', {
        message: 'The changed document could not be read back, so it was not used.',
        details: label,
      });
    }

    const entry = await this.ensureStarted(sessionId, await this.readCurrentBytes(session));
    delete entry.annotations;
    await entry.history.push(label, bytes);
    await this.recordState(sessionId);
    this.deps.logger.info('Applied a change.', session.file.displayName, label);
    return this.state(sessionId);
  }

  /**
   * Every annotation in the document as it stands, read from the file itself.
   *
   * The result is kept until the revision changes, so opening the comments
   * panel or selecting an annotation does not re-read the document.
   */
  async annotations(sessionId: string): Promise<Annotation[]> {
    const session = this.requireSession(sessionId);
    const entry = this.edited.get(sessionId);
    const revision = entry?.history.currentRevision ?? 0;

    if (entry?.annotations !== undefined && entry.annotations.revision === revision) {
      return entry.annotations.list;
    }

    const bytes = await this.readCurrentBytes(session);
    const list = await this.deps.engine.readAnnotations(bytes);
    if (entry !== undefined) entry.annotations = { revision, list };
    return list;
  }

  async undo(sessionId: string): Promise<DocumentEditState> {
    const entry = this.edited.get(sessionId);
    if (entry !== undefined && entry.history.undo() !== undefined) {
      await this.recordState(sessionId);
    }
    return this.state(sessionId);
  }

  async redo(sessionId: string): Promise<DocumentEditState> {
    const entry = this.edited.get(sessionId);
    if (entry !== undefined && entry.history.redo() !== undefined) {
      await this.recordState(sessionId);
    }
    return this.state(sessionId);
  }

  /**
   * Goes back to the document as it was last saved — or as it was opened, when
   * it has not been saved. The revisions in between are kept, so reverting can
   * itself be undone.
   */
  async revert(sessionId: string): Promise<DocumentEditState> {
    const entry = this.edited.get(sessionId);
    if (entry === undefined) return this.state(sessionId);

    if (entry.history.goTo(entry.savedRevision) === undefined) {
      throw new AppError('internal/unexpected', {
        message: 'The saved version of this document is no longer available to go back to.',
        details: `revision ${entry.savedRevision} is outside the history kept on disk`,
      });
    }
    await this.recordState(sessionId);
    return this.state(sessionId);
  }

  /** Save, Save As and Save a Copy, which differ only in where they write. */
  async save(request: SaveRequest): Promise<SaveOutcome> {
    const session = this.requireSession(request.sessionId);
    const destination = request.mode === 'save' ? session.file.path : (request.destination ?? '');
    if (destination === '') {
      throw new AppError('internal/unexpected', {
        message: 'No destination was given for that save.',
        details: `mode ${request.mode}`,
      });
    }

    if (request.mode === 'save') this.assertWritable(session);
    if (request.mode === 'save' && request.force !== true) {
      await this.assertUnchangedOnDisk(session);
    }

    const bytes = await this.readCurrentBytes(session);
    let checkedWithQpdf = false;

    await writeFileAtomic(destination, bytes, {
      // The destination is only replaced once the new file has been reopened
      // from disk — and, when qpdf is installed, inspected by it too.
      validate: async (tempPath) => {
        await this.validateWritten(tempPath, session.file.displayName);
        checkedWithQpdf = await this.checkWithQpdf(tempPath, session.file.displayName);
      },
    });

    const savedAt = new Date().toISOString();
    if (request.mode === 'saveCopy') {
      this.deps.logger.info('Saved a copy.', destination);
      return {
        canceled: false,
        session,
        edit: this.state(request.sessionId),
        path: destination,
        checkedWithQpdf,
      };
    }

    const entry = this.edited.get(request.sessionId);
    if (entry !== undefined) {
      entry.savedRevision = entry.history.currentRevision;
      entry.savedAt = savedAt;
    }

    const updated =
      request.mode === 'saveAs'
        ? await this.deps.documents.retarget(request.sessionId, destination)
        : await this.deps.documents.markSavedByUs(request.sessionId);

    await this.recordState(request.sessionId);
    this.deps.logger.info('Saved a document.', destination);

    return {
      canceled: false,
      session: updated,
      edit: this.state(request.sessionId),
      path: destination,
      checkedWithQpdf,
    };
  }

  /** Forgets a document's history and removes its revisions from disk. */
  async dispose(sessionId: string): Promise<void> {
    const entry = this.edited.get(sessionId);
    if (entry === undefined) return;
    this.edited.delete(sessionId);
    await entry.history.dispose();
  }

  private async ensureStarted(sessionId: string, bytes: Uint8Array): Promise<EditedDocument> {
    const existing = this.edited.get(sessionId);
    if (existing !== undefined) return existing;

    const history = new RevisionHistory(
      path.join(this.deps.workspaceDirectory(sessionId), REVISIONS_DIR_NAME),
    );
    // Revision 0 is the document as it was opened, so undo and revert survive
    // saving over the original.
    await history.begin(bytes);
    const entry: EditedDocument = { history, savedRevision: 0, savedAt: null };
    this.edited.set(sessionId, entry);
    return entry;
  }

  private async recordState(sessionId: string): Promise<void> {
    const entry = this.edited.get(sessionId);
    await this.deps.recordState(sessionId, {
      dirty: entry !== undefined && entry.history.currentRevision !== entry.savedRevision,
      workingCopy: entry?.history.current?.filePath,
    });
  }

  private async readCurrentBytes(session: DocumentSession): Promise<Uint8Array> {
    const filePath = this.currentBytesPath(session.id) ?? session.file.path;
    try {
      return await fs.readFile(filePath);
    } catch (error) {
      throw new AppError('io/not-found', {
        message: 'That document could not be read.',
        details: `${session.file.displayName}: ${String(error)}`,
        cause: error,
      });
    }
  }

  private requireSession(sessionId: string): DocumentSession {
    const session = this.deps.documents.get(sessionId);
    if (session === undefined) {
      throw new AppError('internal/unexpected', {
        message: 'That document is no longer open.',
        details: `session ${sessionId}`,
      });
    }
    return session;
  }

  private assertWritable(session: DocumentSession): void {
    if (!session.file.readOnly) return;
    throw new AppError('io/permission-denied', {
      message: `${session.file.displayName} is read-only. Use Save a Copy instead.`,
      details: session.file.path,
    });
  }

  /** Refuses to overwrite a file somebody else changed since it was opened. */
  private async assertUnchangedOnDisk(session: DocumentSession): Promise<void> {
    let stats;
    try {
      stats = await fs.stat(session.file.path);
    } catch {
      // The file is gone; writing it again is what the reader expects.
      return;
    }

    const modifiedAt = new Date(stats.mtimeMs).toISOString();
    if (stats.size === session.file.sizeBytes && modifiedAt === session.file.modifiedAt) return;

    throw new AppError('io/changed-externally', {
      message: `${session.file.displayName} has changed on disk since you opened it.`,
      details: 'Saving now would overwrite those changes.',
    });
  }

  private async validateWritten(tempPath: string, displayName: string): Promise<void> {
    let written: Uint8Array;
    try {
      written = await fs.readFile(tempPath);
    } catch (error) {
      throw new AppError('io/write-failed', {
        message: `${displayName} could not be written.`,
        details: String(error),
        cause: error,
      });
    }

    const facts = await this.deps.engine.inspect(written);
    if (facts.pageCount < 1) {
      throw new AppError('io/write-failed', {
        message: `${displayName} was not saved: the file PaperForge produced could not be reopened.`,
        details: 'The original file was left untouched.',
      });
    }
  }

  /** Returns true when qpdf ran and was happy enough with the file. */
  private async checkWithQpdf(tempPath: string, displayName: string): Promise<boolean> {
    let result;
    try {
      result = await this.deps.qpdf.check(tempPath);
    } catch (error) {
      // qpdf failing to run is not a reason to refuse a save PaperForge has
      // already validated itself.
      this.deps.logger.warn('qpdf could not check a saved file.', displayName, error);
      return false;
    }

    if (result === undefined) return false;
    if (result.readable) {
      if (!result.ok) this.deps.logger.info('qpdf reported warnings.', displayName, result.output);
      return true;
    }

    throw new AppError('io/write-failed', {
      message: `${displayName} was not saved: qpdf could not read the file PaperForge produced.`,
      details: `The original file was left untouched.\n${result.output.slice(0, 2000)}`,
    });
  }
}
