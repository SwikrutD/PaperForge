import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { RecoveryEntry } from '@shared/schemas/document';
import { writeFileAtomic } from '../filesystem/atomicWrite';
import { readJsonFile } from '../filesystem/readJsonFile';
import type { Logger } from '../logging/logger';

export const JOURNAL_FILE_NAME = 'journal.json';
export const SESSIONS_DIR_NAME = 'sessions';

export const journalSchema = z.object({
  version: z.literal(1),
  sessionId: z.string().min(1),
  documentId: z.string().min(1),
  path: z.string().min(1),
  displayName: z.string().min(1),
  openedAt: z.string().min(1),
  lastTouchedAt: z.string().min(1),
  dirty: z.boolean(),
  /** The process that owned the session, for diagnostics only. */
  pid: z.number().int().nonnegative(),
});
export type Journal = z.infer<typeof journalSchema>;

/**
 * Per-document working directories and their recovery journals.
 *
 * A session directory exists exactly as long as the document is open: it is
 * created on open and removed on a clean close. Anything still on disk at the
 * next start is therefore the remains of a crash, which is what the recovery
 * screen offers back to the user.
 *
 * Segment 5 writes working copies and change entries into the same directory;
 * the journal already carries the dirty flag those will set.
 */
export class SessionWorkspaces {
  readonly root: string;

  constructor(
    tempRoot: string,
    private readonly logger: Logger,
  ) {
    this.root = path.join(tempRoot, SESSIONS_DIR_NAME);
  }

  directoryFor(sessionId: string): string {
    return path.join(this.root, sessionId);
  }

  journalPathFor(sessionId: string): string {
    return path.join(this.directoryFor(sessionId), JOURNAL_FILE_NAME);
  }

  /** Creates the working directory for a session and writes its first journal. */
  async create(journal: Journal): Promise<string> {
    const directory = this.directoryFor(journal.sessionId);
    await fs.mkdir(directory, { recursive: true });
    await this.write(journal);
    return directory;
  }

  async write(journal: Journal): Promise<void> {
    const payload = `${JSON.stringify(journalSchema.parse(journal), null, 2)}\n`;
    await writeFileAtomic(this.journalPathFor(journal.sessionId), payload);
  }

  async read(sessionId: string): Promise<Journal | undefined> {
    try {
      const raw = await readJsonFile(this.journalPathFor(sessionId));
      if (raw === undefined) return undefined;
      const parsed = journalSchema.safeParse(raw);
      return parsed.success ? parsed.data : undefined;
    } catch (error) {
      this.logger.warn('A recovery journal could not be read.', sessionId, error);
      return undefined;
    }
  }

  /** Removes a session directory. Used on clean close and on discard. */
  async remove(sessionId: string): Promise<void> {
    try {
      await fs.rm(this.directoryFor(sessionId), { recursive: true, force: true });
    } catch (error) {
      this.logger.warn('A session directory could not be removed.', sessionId, error);
    }
  }

  /** Every session directory currently on disk. */
  async listSessionIds(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.root, { withFileTypes: true });
      return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    } catch (error) {
      if ((error as { code?: string }).code !== 'ENOENT') {
        this.logger.warn('The session directory could not be listed.', error);
      }
      return [];
    }
  }

  /**
   * Journals left behind by a previous run, newest first. Entries whose journal
   * is missing or unreadable are cleaned up rather than reported.
   */
  async listRecoverable(exclude: ReadonlySet<string> = new Set()): Promise<RecoveryEntry[]> {
    const entries: RecoveryEntry[] = [];

    for (const sessionId of await this.listSessionIds()) {
      if (exclude.has(sessionId)) continue;
      const journal = await this.read(sessionId);
      if (journal === undefined) {
        await this.remove(sessionId);
        continue;
      }
      entries.push({
        sessionId: journal.sessionId,
        path: journal.path,
        displayName: journal.displayName,
        openedAt: journal.openedAt,
        lastTouchedAt: journal.lastTouchedAt,
        dirty: journal.dirty,
        fileStillExists: await fileExists(journal.path),
      });
    }

    return entries.sort((a, b) => b.lastTouchedAt.localeCompare(a.lastTouchedAt));
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(filePath);
    return stats.isFile();
  } catch {
    return false;
  }
}
