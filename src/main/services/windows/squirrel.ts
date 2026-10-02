import { execFile } from 'node:child_process';
import path from 'node:path';
import { APP_NAME } from '@shared/constants/app';
import { readValue, writeKeys, type RegRunner, runReg } from './registry';
import { registerFileAssociation, unregisterFileAssociation } from './fileAssociation';

/**
 * The events the Windows installer starts PaperForge with.
 *
 * The installer (Squirrel) runs the new copy with `--squirrel-install`,
 * `--squirrel-updated` or `--squirrel-uninstall` and expects it to do its
 * setup and exit at once. Shortcuts are made by the installer's own
 * `Update.exe`; the PDF association is written here, under the current user,
 * and taken away again on uninstall. Nothing is downloaded and nothing needs
 * administrator rights.
 */
export type SquirrelEvent = 'install' | 'updated' | 'uninstall' | 'obsolete' | 'firstrun';

const SHORTCUT_TIMEOUT_MS = 30_000;
const UNINSTALL_KEY = `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${APP_NAME}`;

export function readSquirrelEvent(argv: readonly string[]): SquirrelEvent | null {
  const match = /^--squirrel-(install|updated|uninstall|obsolete|firstrun)$/.exec(argv[1] ?? '');
  return match === null ? null : (match[1] as SquirrelEvent);
}

export interface SquirrelPaths {
  /** The installer's Update.exe, one folder above the running version. */
  updateExe: string;
  /** The launcher that always starts the current version. */
  launcher: string;
  /** The running executable's file name, which shortcuts are made for. */
  exeName: string;
}

export function squirrelPaths(execPath: string): SquirrelPaths {
  const root = path.resolve(path.dirname(execPath), '..');
  const exeName = path.basename(execPath);
  return {
    updateExe: path.join(root, 'Update.exe'),
    launcher: path.join(root, exeName),
    exeName,
  };
}

/** The Update.exe arguments for each event that changes shortcuts. */
export function shortcutArgs(event: SquirrelEvent, exeName: string): string[] | null {
  switch (event) {
    case 'install':
      return [`--createShortcut=${exeName}`, '--shortcut-locations=StartMenu,Desktop'];
    // An update refreshes the Start menu entry only, so a desktop shortcut the
    // reader deleted does not come back.
    case 'updated':
      return [`--createShortcut=${exeName}`, '--shortcut-locations=StartMenu'];
    case 'uninstall':
      return [`--removeShortcut=${exeName}`, '--shortcut-locations=StartMenu,Desktop'];
    default:
      return null;
  }
}

/**
 * Does what an installer event asks. Returns true when PaperForge should exit
 * straight away rather than start.
 */
export async function handleSquirrelEvent(
  event: SquirrelEvent,
  execPath: string,
  run: RegRunner = runReg,
): Promise<boolean> {
  if (event === 'firstrun') return false;
  if (event === 'obsolete') return true;

  const paths = squirrelPaths(execPath);
  const args = shortcutArgs(event, paths.exeName);
  if (args !== null) await runUpdate(paths.updateExe, args);

  if (event === 'uninstall') {
    await unregisterFileAssociation(paths.launcher, run);
    return true;
  }

  await registerFileAssociation(paths.launcher, run);
  await pointUninstallIcon(execPath, run);
  return true;
}

/**
 * The installer cannot fetch an icon for Apps & features without going
 * online, so PaperForge points the entry at its own. The entry may not be
 * there yet during the install event, so this runs again on the first run,
 * and never creates an entry the installer has not.
 */
export async function pointUninstallIcon(execPath: string, run: RegRunner = runReg): Promise<void> {
  const { launcher } = squirrelPaths(execPath);
  if ((await readValue(UNINSTALL_KEY, 'DisplayName', run)) === null) return;
  await writeKeys(
    [
      {
        key: UNINSTALL_KEY,
        values: [{ name: 'DisplayIcon', type: 'REG_SZ', data: `"${launcher}",0` }],
      },
    ],
    run,
  );
}

function runUpdate(updateExe: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve) => {
    execFile(updateExe, [...args], { windowsHide: true, timeout: SHORTCUT_TIMEOUT_MS }, () => {
      resolve();
    });
  });
}
