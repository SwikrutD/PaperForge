import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import electronBinary from 'electron';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * The window PaperForge opens: no stray Electron menu or its accelerators, and
 * a home screen and status bar that say useful things.
 */
const mainBundle = path.resolve('.vite', 'build', 'main.js');

let app: ElectronApplication;
let page: Page;
let sandbox = '';

test.beforeAll(async () => {
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'paperforge-shell-'));
  app = await electron.launch({
    executablePath: electronBinary as unknown as string,
    args: [mainBundle, `--user-data-dir=${path.join(sandbox, 'profile')}`],
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

test('there is no Electron application menu', async () => {
  const hasMenu = await app.evaluate(({ Menu }) => Menu.getApplicationMenu() !== null);
  expect(hasMenu).toBe(false);
});

test('Ctrl+R does not reload the window', async () => {
  await page.evaluate(() => {
    (window as unknown as { stillHere: boolean }).stillHere = true;
  });
  await page.keyboard.press('Control+r');
  await page.waitForTimeout(500);
  const stillHere = await page.evaluate(
    () => (window as unknown as { stillHere?: boolean }).stillHere === true,
  );
  expect(stillHere).toBe(true);
});

test('Ctrl+minus does not zoom the window itself', async () => {
  await page.keyboard.press('Control+-');
  await page.waitForTimeout(300);
  const zoom = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.webContents.getZoomFactor(),
  );
  expect(zoom).toBe(1);
});

test('the home screen offers to open and create a PDF', async () => {
  await expect(page.getByRole('button', { name: 'Open PDF' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create PDF', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Edit PDF/ })).toBeEnabled();
});

test('the status bar says how to start, not which theme is on', async () => {
  const statusBar = page.getByRole('contentinfo');
  await expect(statusBar).toContainText('No document open');
  await expect(statusBar).not.toContainText('Theme');
  await expect(statusBar).not.toContainText('Ready');
});
