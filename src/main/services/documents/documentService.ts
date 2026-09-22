import fs from 'node:fs/promises';
import { watch, type FSWatcher } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { AppError } from '@shared/errors/appError';
import type {
  DocumentSession,
  FileChangeEvent,
  OpenFailure,
  OpenResult,
} from '@shared/schemas/document';
import type { RecentFilesStore } from '../recentFiles/recentFilesStore';
import type { SessionWorkspaces } from '../recovery/recoveryJournal';
import type { Logger } from '../logging/logger';
import { documentIdForPath, inspectDocument } from './documentInspector';

/** Coalesces the burst of events Windows emits for a single save. */
const WATCH_DEBOUNCE_MS = 250;

export interface OpenOptions {
  /** Restoring a session should not reorder the recent files list. */
  recordAsRecent?: boolean;
}

export interface DocumentServiceDeps {
  workspaces: SessionWorkspaces;
  recentFiles: RecentFilesStore;
  logger: Logger;
  onFileChange: (event: FileChangeEvent) => void;
  /** Called whenever the set of open paths changes, for session restore. */
  onOpenPathsChanged: (paths: string[]) => void;
}

interface TrackedSession {
  session: DocumentSession;
  watcher: FSWatcher | undefined;
  timer: NodeJS.Timeout | undefined;
}

/**
 * Owns open document sessions: inspection, the per-document working directory,
 * the recovery journal, and watching the file for outside changes.
 *
 * Nothing here writes to the user's file. Opening is read-only, and the
 * working directory exists so later segments can stage changes safely.
 */
export class DocumentService {
  private readonly tracked = new Map<string, TrackedSession>();

  constructor(private readonly deps: DocumentServiceDeps) {}

  list(): DocumentSession[] {
    return [...this.tracked.values()].map((entry) => entry.session);
  }

  get(sessionId: string): DocumentSession | undefined {
    return this.tracked.get(sessionId)?.session;
  }

  /**
   * Opens files one by one so a single bad path cannot fail the batch. Opening
   * a file that is already open returns the existing session.
   */
  async openPaths(paths: readonly string[], options: OpenOptions = {}): Promise<OpenResult> {
    const sessions: DocumentSession[] = [];
    const failures: OpenFailure[] = [];

    for (const candidate of paths) {
      try {
        sessions.push(await this.openOne(candidate, options));
      } catch (error) {
        const serialized = AppError.serialize(error);
        this.deps.logger.warn('Could not open a file.', candidate, serialized.code);
        failures.push({
          path: candidate,
          code: serialized.code,
          message: serialized.message,
          ...(serialized.details === undefined ? {} : { details: serialized.details }),
        });
      }
    }

    if (sessions.length > 0) this.notifyOpenPaths();
    return { sessions, failures, canceled: false };
  }

  private async openOne(filePath: string, options: OpenOptions): Promise<DocumentSession> {
    const file = await inspectDocument(filePath);
    const documentId = documentIdForPath(file.path);

    const existing = this.list().find((session) => session.documentId === documentId);
    if (existing !== undefined) return existing;

    const session: DocumentSession = {
      id: randomUUID(),
      documentId,
      file,
      openedAt: new Date().toISOString(),
      dirty: false,
    };

    const now = session.openedAt;
    await this.deps.workspaces.create({
      version: 1,
      sessionId: session.id,
      documentId,
      path: file.path,
      displayName: file.displayName,
      openedAt: now,
      lastTouchedAt: now,
      dirty: false,
      pid: process.pid,
    });

    this.tracked.set(session.id, {
      session,
      watcher: this.startWatching(session),
      timer: undefined,
    });

    if (options.recordAsRecent !== false) {
      await this.deps.recentFiles.add({
        path: file.path,
        displayName: file.displayName,
        sizeBytes: file.sizeBytes,
      });
    }

    this.deps.logger.info('Opened a document.', file.displayName);
    return session;
  }

  async close(sessionId: string): Promise<void> {
    const entry = this.tracked.get(sessionId);
    if (entry === undefined) return;

    if (entry.timer !== undefined) clearTimeout(entry.timer);
    entry.watcher?.close();
    this.tracked.delete(sessionId);
    // A session directory that survives the process is what recovery looks for,
    // so a clean close must remove it.
    await this.deps.workspaces.remove(sessionId);
    this.notifyOpenPaths();
  }

  async closeAll(): Promise<void> {
    for (const sessionId of [...this.tracked.keys()]) {
      await this.close(sessionId);
    }
  }

  /** Records unsaved changes in the journal. Used by the editing segments. */
  async setDirty(sessionId: string, dirty: boolean): Promise<void> {
    const entry = this.tracked.get(sessionId);
    if (entry === undefined || entry.session.dirty === dirty) return;

    entry.session = { ...entry.session, dirty };
    const journal = await this.deps.workspaces.read(sessionId);
    if (journal === undefined) return;
    await this.deps.workspaces.write({
      ...journal,
      dirty,
      lastTouchedAt: new Date().toISOString(),
    });
  }

  /** Session ids currently open, so recovery can ignore them. */
  activeSessionIds(): Set<string> {
    return new Set(this.tracked.keys());
  }

  private notifyOpenPaths(): void {
    this.deps.onOpenPathsChanged(this.list().map((session) => session.file.path));
  }

  private startWatching(session: DocumentSession): FSWatcher | undefined {
    try {
      const watcher = watch(session.file.path, { persistent: false }, () => {
        this.scheduleChangeCheck(session.id);
      });
      watcher.on('error', (error) => {
        this.deps.logger.warn('Stopped watching a file.', session.file.displayName, error);
      });
      return watcher;
    } catch (error) {
      this.deps.logger.warn('Could not watch a file for changes.', session.file.path, error);
      return undefined;
    }
  }

  private scheduleChangeCheck(sessionId: string): void {
    const entry = this.tracked.get(sessionId);
    if (entry === undefined) return;
    if (entry.timer !== undefined) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      void this.checkForChange(sessionId);
    }, WATCH_DEBOUNCE_MS);
  }

  private async checkForChange(sessionId: string): Promise<void> {
    const entry = this.tracked.get(sessionId);
    if (entry === undefined) return;
    entry.timer = undefined;

    try {
      const stats = await fs.stat(entry.session.file.path);
      const modifiedAt = new Date(stats.mtimeMs).toISOString();
      if (
        stats.size === entry.session.file.sizeBytes &&
        modifiedAt === entry.session.file.modifiedAt
      ) {
        return;
      }
      const file = await inspectDocument(entry.session.file.path);
      entry.session = { ...entry.session, file };
      this.deps.onFileChange({ sessionId, change: 'modified', file });
    } catch {
      this.deps.onFileChange({ sessionId, change: 'deleted', file: null });
    }
  }
}
