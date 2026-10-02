import path from 'node:path';
import type { RecentFileEntry } from '@shared/schemas/recentFiles';
import { NEW_WINDOW_ARG } from './launchArgs';

/** Windows shows about ten items a category before the list gets long. */
const PINNED_LIMIT = 10;
const RECENT_LIMIT = 8;

/**
 * The taskbar jump list: the reader's pinned files, the files opened most
 * recently, and a task that opens another window.
 *
 * Each file is a task that starts PaperForge with the file's path, which the
 * running copy receives as a second instance and opens. That works whether or
 * not PaperForge is the default PDF app, which Windows' own "Recent" list
 * would require.
 */
export function buildJumpList(
  entries: readonly RecentFileEntry[],
  executable: string,
): Electron.JumpListCategory[] {
  const fileItem = (entry: RecentFileEntry): Electron.JumpListItem => ({
    type: 'task',
    title: entry.displayName,
    description: entry.path,
    program: executable,
    // Quoted, so a path with spaces arrives as one argument.
    args: `"${entry.path}"`,
    iconPath: executable,
    iconIndex: 0,
  });

  const pinned = entries.filter((entry) => entry.pinned).slice(0, PINNED_LIMIT);
  const recent = entries.filter((entry) => !entry.pinned).slice(0, RECENT_LIMIT);

  const categories: Electron.JumpListCategory[] = [];
  if (pinned.length > 0) {
    categories.push({ type: 'custom', name: 'Pinned', items: pinned.map(fileItem) });
  }
  if (recent.length > 0) {
    categories.push({ type: 'custom', name: 'Recent', items: recent.map(fileItem) });
  }
  categories.push({
    type: 'tasks',
    items: [
      {
        type: 'task',
        title: 'New window',
        description: 'Open another PaperForge window',
        program: executable,
        args: NEW_WINDOW_ARG,
        iconPath: executable,
        iconIndex: 0,
      },
    ],
  });
  return categories;
}

/**
 * The program shortcuts and associations should start. An installed copy
 * lives in a versioned `app-x.y.z` folder that an update replaces; the
 * installer keeps a launcher of the same name one folder up, which always
 * starts the current version, so that is the one to point at.
 */
export function stableExecutable(execPath: string, exists: (candidate: string) => boolean): string {
  const folder = path.dirname(execPath);
  if (!/^app-\d/i.test(path.basename(folder))) return execPath;
  const launcher = path.join(path.dirname(folder), path.basename(execPath));
  return exists(launcher) ? launcher : execPath;
}
