import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  launchArgsToSkip,
  NEW_WINDOW_ARG,
  parseLaunchArgs,
} from '../../../src/main/services/windows/launchArgs';
import { buildJumpList, stableExecutable } from '../../../src/main/services/windows/jumpList';
import {
  associationKeys,
  openCommand,
  PROG_ID,
  readAssociation,
  unregisterFileAssociation,
} from '../../../src/main/services/windows/fileAssociation';
import {
  handleSquirrelEvent,
  readSquirrelEvent,
  shortcutArgs,
  squirrelPaths,
} from '../../../src/main/services/windows/squirrel';
import type { RegRunner } from '../../../src/main/services/windows/registry';
import type { RecentFileEntry } from '../../../src/shared/schemas/recentFiles';

const cwd = 'C:\\Users\\Zoë\\Documents';

describe('launch arguments', () => {
  it('opens the PDF paths Explorer hands over, resolved against the launch directory', () => {
    const request = parseLaunchArgs(
      [
        'C:\\Program Files\\PaperForge\\PaperForge.exe',
        'Quarterly Report.pdf',
        'D:\\Scans\\Großer Plan.PDF',
      ],
      { cwd, skip: 1 },
    );
    expect(request.newWindow).toBe(false);
    expect(request.paths).toEqual([
      path.resolve(cwd, 'Quarterly Report.pdf'),
      path.resolve('D:\\Scans\\Großer Plan.PDF'),
    ]);
  });

  it('ignores switches, URLs, device paths, other files and duplicates', () => {
    const request = parseLaunchArgs(
      [
        'PaperForge.exe',
        '--allow-file-access-from-files',
        '--squirrel-firstrun',
        'https://example.com/evil.pdf',
        'file:///C:/docs/a.pdf',
        '\\\\.\\pipe\\x.pdf',
        '\\\\?\\GLOBALROOT\\Device\\x.pdf',
        'notes.txt',
        'C:\\docs\\a.pdf',
        'c:\\DOCS\\A.pdf',
      ],
      { cwd, skip: 1 },
    );
    expect(request.paths).toEqual([path.resolve('C:\\docs\\a.pdf')]);
  });

  it('keeps long-path and network spellings of ordinary files', () => {
    const request = parseLaunchArgs(
      ['PaperForge.exe', '\\\\?\\C:\\deep\\file.pdf', '\\\\server\\share\\file.pdf'],
      { cwd, skip: 1 },
    );
    expect(request.paths).toHaveLength(2);
  });

  it('reads the jump list request for a new window', () => {
    expect(parseLaunchArgs(['PaperForge.exe', NEW_WINDOW_ARG], { cwd, skip: 1 })).toEqual({
      paths: [],
      newWindow: true,
    });
  });

  it('skips Electron and its entry script in development', () => {
    const argv = ['electron.exe', '--inspect=0', 'H:\\app\\.vite\\build\\main.js', 'a.pdf'];
    expect(launchArgsToSkip(argv, false)).toBe(3);
    expect(launchArgsToSkip(['PaperForge.exe', 'a.pdf'], true)).toBe(1);
    expect(parseLaunchArgs(argv, { cwd, skip: launchArgsToSkip(argv, false) }).paths).toEqual([
      path.resolve(cwd, 'a.pdf'),
    ]);
  });
});

describe('installed executable', () => {
  const versioned = 'C:\\Users\\Zoë\\AppData\\Local\\PaperForge\\app-0.1.0\\PaperForge.exe';
  const launcher = 'C:\\Users\\Zoë\\AppData\\Local\\PaperForge\\PaperForge.exe';

  it('points at the launcher that survives updates', () => {
    expect(stableExecutable(versioned, (candidate) => candidate === launcher)).toBe(launcher);
  });

  it('keeps the running executable anywhere else', () => {
    expect(stableExecutable(versioned, () => false)).toBe(versioned);
    expect(stableExecutable('D:\\Portable\\PaperForge.exe', () => true)).toBe(
      'D:\\Portable\\PaperForge.exe',
    );
  });
});

describe('jump list', () => {
  const entry = (name: string, pinned: boolean): RecentFileEntry => ({
    path: `C:\\Docs\\${name}`,
    displayName: name,
    lastOpenedAt: '2026-10-02T10:00:00.000Z',
    pinned,
  });

  it('lists pinned and recent files as tasks that open them, and a new window', () => {
    const categories = buildJumpList(
      [entry('Pinned plan.pdf', true), entry('Recent memo.pdf', false)],
      'C:\\PaperForge\\PaperForge.exe',
    );
    expect(categories.map((category) => category.name ?? category.type)).toEqual([
      'Pinned',
      'Recent',
      'tasks',
    ]);
    expect(categories[0]?.items?.[0]).toMatchObject({
      type: 'task',
      title: 'Pinned plan.pdf',
      program: 'C:\\PaperForge\\PaperForge.exe',
      args: '"C:\\Docs\\Pinned plan.pdf"',
    });
    expect(categories[2]?.items?.[0]?.args).toBe(NEW_WINDOW_ARG);
  });

  it('leaves out empty categories', () => {
    expect(buildJumpList([], 'C:\\PaperForge.exe').map((category) => category.type)).toEqual([
      'tasks',
    ]);
  });
});

describe('PDF file association', () => {
  const exe = 'C:\\Users\\Zoë Smith\\AppData\\Local\\PaperForge\\PaperForge.exe';

  it('writes only per-user keys, opening the file with PaperForge', () => {
    const keys = associationKeys(exe);
    expect(keys.every((entry) => entry.key.startsWith('HKCU\\'))).toBe(true);
    const command = keys.find((entry) => entry.key.endsWith(`${PROG_ID}\\shell\\open\\command`));
    expect(command?.values[0]?.data).toBe(`"${exe}" "%1"`);
    const openWith = keys.find((entry) => entry.key.endsWith('.pdf\\OpenWithProgids'));
    expect(openWith?.values[0]).toMatchObject({ name: PROG_ID, type: 'REG_NONE' });
    expect(keys.some((entry) => entry.key === 'HKCU\\Software\\RegisteredApplications')).toBe(true);
  });

  it('never claims the .pdf default itself', () => {
    const keys = associationKeys(exe);
    expect(
      keys.some((entry) => entry.key === 'HKCU\\Software\\Classes\\.pdf' && entry.values.length),
    ).toBe(false);
    expect(keys.some((entry) => entry.key.includes('UserChoice'))).toBe(false);
  });

  it('reads whether PaperForge is offered, and whether it is the default', async () => {
    const registry = new Map<string, string>([
      [`shell\\open\\command`, openCommand(exe)],
      ['OpenWithProgids', ''],
      ['UserChoice', PROG_ID],
    ]);
    const run: RegRunner = (args) => {
      const key = args[1] ?? '';
      const hit = [...registry.entries()].find(([fragment]) => key.endsWith(fragment));
      if (hit === undefined) return Promise.resolve({ code: 1, stdout: '' });
      const name = args[2] === '/ve' ? '(Default)' : (args[3] ?? '');
      return Promise.resolve({
        code: 0,
        stdout: `\r\n${key}\r\n    ${name}    REG_SZ    ${hit[1]}\r\n`,
      });
    };
    await expect(readAssociation(exe, run)).resolves.toEqual({ openWith: true, isDefault: true });

    registry.delete('UserChoice');
    await expect(readAssociation(exe, run)).resolves.toEqual({ openWith: true, isDefault: false });

    // A different copy of PaperForge registered is not this one.
    await expect(readAssociation('D:\\Other\\PaperForge.exe', run)).resolves.toEqual({
      openWith: false,
      isDefault: false,
    });
  });

  it('removes exactly what it added', async () => {
    const calls: string[][] = [];
    const run: RegRunner = (args) => {
      calls.push([...args]);
      return Promise.resolve({ code: 0, stdout: '' });
    };
    await unregisterFileAssociation(exe, run);
    expect(calls.every((call) => call[0] === 'delete')).toBe(true);
    // The .pdf key itself, and whatever else is registered for it, stay.
    expect(calls.some((call) => call[1] === 'HKCU\\Software\\Classes\\.pdf')).toBe(false);
    expect(calls).toContainEqual([
      'delete',
      'HKCU\\Software\\Classes\\.pdf\\OpenWithProgids',
      '/v',
      PROG_ID,
      '/f',
    ]);
  });
});

describe('installer events', () => {
  it('recognises only the events the installer sends, in first position', () => {
    expect(readSquirrelEvent(['PaperForge.exe', '--squirrel-install', '0.1.0'])).toBe('install');
    expect(readSquirrelEvent(['PaperForge.exe', '--squirrel-firstrun'])).toBe('firstrun');
    expect(readSquirrelEvent(['PaperForge.exe', 'a.pdf', '--squirrel-uninstall'])).toBeNull();
    expect(readSquirrelEvent(['PaperForge.exe', '--squirrel-everything'])).toBeNull();
  });

  it('finds the installer beside the versioned folder', () => {
    const paths = squirrelPaths('C:\\Local\\PaperForge\\app-0.1.0\\PaperForge.exe');
    expect(paths.updateExe).toBe(path.join('C:\\Local\\PaperForge', 'Update.exe'));
    expect(paths.launcher).toBe(path.join('C:\\Local\\PaperForge', 'PaperForge.exe'));
  });

  it('makes shortcuts on install, keeps a deleted desktop shortcut gone on update', () => {
    expect(shortcutArgs('install', 'PaperForge.exe')).toEqual([
      '--createShortcut=PaperForge.exe',
      '--shortcut-locations=StartMenu,Desktop',
    ]);
    expect(shortcutArgs('updated', 'PaperForge.exe')?.[1]).toBe('--shortcut-locations=StartMenu');
    expect(shortcutArgs('uninstall', 'PaperForge.exe')?.[0]).toBe(
      '--removeShortcut=PaperForge.exe',
    );
    expect(shortcutArgs('firstrun', 'PaperForge.exe')).toBeNull();
  });

  it('registers on install and unregisters on uninstall, then exits', async () => {
    const calls: string[][] = [];
    const run: RegRunner = (args) => {
      calls.push([...args]);
      return Promise.resolve({ code: args[0] === 'query' ? 1 : 0, stdout: '' });
    };
    const exe = path.join(process.cwd(), 'missing-install', 'app-0.1.0', 'PaperForge.exe');

    await expect(handleSquirrelEvent('install', exe, run)).resolves.toBe(true);
    expect(calls.some((call) => call[0] === 'add' && call.includes(PROG_ID))).toBe(true);
    // No uninstall entry yet, so its icon is left for the first run.
    expect(calls.some((call) => call[0] === 'add' && call[1]?.includes('Uninstall'))).toBe(false);

    calls.length = 0;
    await expect(handleSquirrelEvent('uninstall', exe, run)).resolves.toBe(true);
    expect(calls.every((call) => call[0] === 'delete')).toBe(true);

    await expect(handleSquirrelEvent('firstrun', exe, run)).resolves.toBe(false);
    await expect(handleSquirrelEvent('obsolete', exe, run)).resolves.toBe(true);
  });
});
