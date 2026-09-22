import path from 'node:path';
import {
  applyRetention,
  EMPTY_RECENT_FILES,
  isSamePath,
  parseStoredRecentFiles,
  RECENT_FILES_VERSION,
  type RecentFileEntry,
} from '@shared/schemas/recentFiles';
import { writeFileAtomic } from '../filesystem/atomicWrite';
import { readJsonFile } from '../filesystem/readJsonFile';
import type { Logger } from '../logging/logger';

export const RECENT_FILES_FILE_NAME = 'recent-files.json';

export type RecentFilesListener = (entries: RecentFileEntry[]) => void;

export interface AddRecentFileInput {
  path: string;
  displayName?: string;
  sizeBytes?: number;
  /** Overridable so tests are deterministic. */
  openedAt?: Date;
}

/**
 * The local recent and pinned file list.
 *
 * Entries are paths on this computer and are never transmitted anywhere.
 * Reads are validated and repaired rather than trusted, and writes go through
 * the atomic write helper.
 */
export class RecentFilesStore {
  private readonly filePath: string;
  private readonly listeners = new Set<RecentFilesListener>();
  private entries: RecentFileEntry[] | undefined;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    directory: string,
    private readonly logger: Logger,
  ) {
    this.filePath = path.join(directory, RECENT_FILES_FILE_NAME);
  }

  async load(): Promise<RecentFileEntry[]> {
    let raw: unknown;
    try {
      raw = await readJsonFile(this.filePath);
    } catch (error) {
      this.logger.warn('Recent files list unreadable; starting empty.', error);
      this.entries = [];
      return [];
    }
    if (raw === undefined) {
      this.entries = [];
      return [];
    }

    const { file, repaired } = parseStoredRecentFiles(raw);
    if (repaired) this.logger.warn('Recent files list contained invalid entries; repaired.');
    this.entries = file.entries;
    return this.list();
  }

  list(): RecentFileEntry[] {
    return [...(this.entries ?? EMPTY_RECENT_FILES.entries)];
  }

  /** Records an opened file, moving an existing entry to the top. */
  async add(input: AddRecentFileInput): Promise<RecentFileEntry[]> {
    const current = this.entries ?? [];
    const existing = current.find((entry) => isSamePath(entry.path, input.path));
    const entry: RecentFileEntry = {
      path: input.path,
      displayName: input.displayName ?? path.basename(input.path),
      lastOpenedAt: (input.openedAt ?? new Date()).toISOString(),
      pinned: existing?.pinned ?? false,
      ...(input.sizeBytes === undefined ? {} : { sizeBytes: input.sizeBytes }),
    };

    const withoutEntry = current.filter((item) => !isSamePath(item.path, input.path));
    return this.commit(applyRetention([entry, ...withoutEntry]));
  }

  async setPinned(filePath: string, pinned: boolean): Promise<RecentFileEntry[]> {
    const current = this.entries ?? [];
    const next = current.map((entry) =>
      isSamePath(entry.path, filePath) ? { ...entry, pinned } : entry,
    );
    return this.commit(applyRetention(next));
  }

  async remove(filePath: string): Promise<RecentFileEntry[]> {
    const current = this.entries ?? [];
    return this.commit(current.filter((entry) => !isSamePath(entry.path, filePath)));
  }

  /** Clears everything, including pinned entries. Offered under Privacy. */
  async clear(): Promise<RecentFileEntry[]> {
    return this.commit([]);
  }

  onChange(listener: RecentFilesListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async commit(entries: RecentFileEntry[]): Promise<RecentFileEntry[]> {
    this.entries = entries;
    for (const listener of this.listeners) listener(this.list());
    await this.persist(entries);
    return this.list();
  }

  private persist(entries: RecentFileEntry[]): Promise<void> {
    const payload = `${JSON.stringify({ version: RECENT_FILES_VERSION, entries }, null, 2)}\n`;
    this.writeChain = this.writeChain
      .catch(() => undefined)
      .then(() => writeFileAtomic(this.filePath, payload))
      .catch((error: unknown) => {
        this.logger.error('Failed to persist the recent files list.', error);
      });
    return this.writeChain;
  }
}
