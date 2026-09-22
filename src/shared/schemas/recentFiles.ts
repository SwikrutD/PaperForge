import { z } from 'zod';

export const RECENT_FILES_VERSION = 1;

/** How many unpinned entries are kept. Pinned entries are kept in addition. */
export const RECENT_FILES_LIMIT = 20;
export const PINNED_FILES_LIMIT = 30;

export const recentFileEntrySchema = z.object({
  /** Absolute path on this computer. Never leaves it. */
  path: z.string().min(1),
  /** File name shown in the UI, kept separately so a rename is visible. */
  displayName: z.string().min(1),
  /** ISO timestamp of the last time PaperForge opened the file. */
  lastOpenedAt: z.string().min(1),
  pinned: z.boolean(),
  sizeBytes: z.number().int().nonnegative().optional(),
});
export type RecentFileEntry = z.infer<typeof recentFileEntrySchema>;

export const recentFilesFileSchema = z.object({
  version: z.literal(RECENT_FILES_VERSION),
  entries: z.array(recentFileEntrySchema).max(RECENT_FILES_LIMIT + PINNED_FILES_LIMIT),
});
export type RecentFilesFile = z.infer<typeof recentFilesFileSchema>;

export const recentFilesListSchema = z.array(recentFileEntrySchema);

export const EMPTY_RECENT_FILES: RecentFilesFile = {
  version: RECENT_FILES_VERSION,
  entries: [],
};

/** Windows paths are case-insensitive, so identity is compared case-folded. */
export function isSamePath(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Applies the retention policy: newest first, pinned entries always kept, and
 * at most RECENT_FILES_LIMIT unpinned entries.
 */
export function applyRetention(entries: readonly RecentFileEntry[]): RecentFileEntry[] {
  const sorted = [...entries].sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt));
  const pinned = sorted.filter((entry) => entry.pinned).slice(0, PINNED_FILES_LIMIT);
  const unpinned = sorted.filter((entry) => !entry.pinned).slice(0, RECENT_FILES_LIMIT);
  return [...pinned, ...unpinned];
}

/** Parses a stored recent-files file, discarding anything unreadable. */
export function parseStoredRecentFiles(value: unknown): {
  file: RecentFilesFile;
  repaired: boolean;
} {
  const direct = recentFilesFileSchema.safeParse(value);
  if (direct.success) return { file: direct.data, repaired: false };

  if (
    value !== null &&
    typeof value === 'object' &&
    Array.isArray((value as RecentFilesFile).entries)
  ) {
    const entries = (value as { entries: unknown[] }).entries
      .map((entry) => recentFileEntrySchema.safeParse(entry))
      .filter((result) => result.success)
      .map((result) => result.data);
    return {
      file: { version: RECENT_FILES_VERSION, entries: applyRetention(entries) },
      repaired: true,
    };
  }
  return { file: EMPTY_RECENT_FILES, repaired: true };
}
