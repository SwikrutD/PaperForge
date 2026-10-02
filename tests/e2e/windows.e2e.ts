import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import electronBinary from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildPdf } from '../fixtures/pdf';

const mainBundle = path.resolve('.vite', 'build', 'main.js');

let app: ElectronApplication;
let page: Page;
let sandbox = '';
let profile = '';

/**
 * Starts PaperForge a second time with the same profile, the way Explorer
 * does when a file is double-clicked while it is already open. The second
 * copy hands its arguments over and exits.
 */
function launchAgain(args: string[]): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      electronBinary as unknown as string,
      [mainBundle, `--user-data-dir=${profile}`, ...args],
      { cwd: sandbox, stdio: 'ignore' },
    );
    child.on('error', reject);
    child.on('exit', (code) => resolve(code));
  });
}

test.beforeAll(async () => {
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'paperforge-windows-'));
  profile = path.join(sandbox, 'profile');
  for (const name of ['First file.pdf', 'Second ü.pdf', 'Third.pdf']) {
    await fs.writeFile(path.join(sandbox, name), buildPdf({ pages: [{ text: name }] }));
  }
  await fs.writeFile(path.join(sandbox, 'notes.txt'), 'not a PDF');

  // Started the way Open With starts it: with a file, relative to its folder.
  app = await electron.launch({
    executablePath: electronBinary as unknown as string,
    args: [mainBundle, `--user-data-dir=${profile}`, 'First file.pdf'],
    cwd: sandbox,
  });
  page = await app.firstWindow();
  await page.waitForSelector('[data-focus-region="workspace"]');
});

test.afterAll(async () => {
  await app?.close();
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await fs.rm(sandbox, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
});

test('opens the file it was started with', async () => {
  await expect(page.getByRole('tab', { name: /First file\.pdf/ })).toBeVisible();
  await expect(page.getByLabel('Page 1')).toBeVisible();
});

test('a second launch hands its files to the running window, ignoring anything else', async () => {
  const code = await launchAgain([
    path.join(sandbox, 'Second ü.pdf'),
    'Third.pdf',
    'notes.txt',
    'https://example.com/remote.pdf',
  ]);
  expect(code).toBe(0);

  await expect(page.getByRole('tab', { name: /Second ü\.pdf/ })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Third\.pdf/ })).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(3);
  expect(app.windows()).toHaveLength(1);
});

test('the jump list task opens another window', async () => {
  const opened = app.waitForEvent('window');
  await launchAgain(['--new-window']);
  const second = await opened;
  await second.waitForSelector('[data-focus-region="workspace"]');
  expect(app.windows()).toHaveLength(2);
  await second.close();
});

test('long work shows on the taskbar button', async () => {
  await app.evaluate(({ BrowserWindow }) => {
    const store = globalThis as unknown as { progress: number[] };
    store.progress = [];
    const [window] = BrowserWindow.getAllWindows();
    if (window === undefined) return;
    const prototype = Object.getPrototypeOf(window) as Electron.BrowserWindow;
    const original = prototype.setProgressBar.bind(window);
    prototype.setProgressBar = function setProgressBar(
      this: Electron.BrowserWindow,
      value: number,
      options?: Electron.ProgressBarOptions,
    ): void {
      store.progress.push(value);
      original(value, options);
    };
    // Printing goes nowhere, so the job runs without a printer.
    const contents = Object.getPrototypeOf(window.webContents) as Electron.WebContents;
    contents.print = function print(
      _options?: Electron.WebContentsPrintOptions,
      callback?: (success: boolean, reason: string) => void,
    ): void {
      callback?.(true, '');
    };
  });

  await page.getByRole('tab', { name: /First file\.pdf/ }).click();
  await page.getByLabel('Page 1').click();
  await page.keyboard.press('Control+P');
  await page.getByRole('dialog', { name: 'Print' }).getByRole('button', { name: 'Print' }).click();
  await expect(page.getByText('Sent 1 page to the printer')).toBeVisible();

  await expect
    .poll(() => app.evaluate(() => (globalThis as unknown as { progress: number[] }).progress))
    .toContain(-1);
  const progress = await app.evaluate(
    () => (globalThis as unknown as { progress: number[] }).progress,
  );
  // Some progress while it ran, then cleared.
  expect(progress.some((value) => value >= 0)).toBe(true);
  expect(progress.at(-1)).toBe(-1);
});

test('settings say a development build is not offered for PDF files', async () => {
  await page.keyboard.press('Control+,');
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await expect(settings.getByText(/This is a development build/)).toBeVisible();
  await expect(settings.getByRole('button', { name: 'Open Windows Settings' })).toBeDisabled();
  await expect(settings.getByText('Notify when work finishes')).toBeVisible();
  await page.keyboard.press('Escape');
});
