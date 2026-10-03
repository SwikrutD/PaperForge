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
import { navigationDocument } from '../fixtures/pdf';

const mainBundle = path.resolve('.vite', 'build', 'main.js');

/** Schemes a request may use without leaving the machine. */
const LOCAL_SCHEMES = new Set(['app:', 'pfdoc:', 'blob:', 'data:', 'file:', 'devtools:']);

let app: ElectronApplication;
let page: Page;
let sandbox = '';
const requested: string[] = [];

test.beforeAll(async () => {
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'paperforge-offline-'));
  app = await electron.launch({
    executablePath: electronBinary as unknown as string,
    args: [mainBundle, `--user-data-dir=${path.join(sandbox, 'profile')}`],
  });
  page = await app.firstWindow();
  page.on('request', (request) => requested.push(request.url()));
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

test('reading, searching and browsing a document asks nothing of the network', async () => {
  const documentPath = path.join(sandbox, 'Offline.pdf');
  await fs.writeFile(documentPath, navigationDocument());
  await page.evaluate(
    (target: string) => window.paperforge.invoke('files:openPaths', { paths: [target] }),
    documentPath,
  );
  await page.getByRole('button', { name: 'Open Offline.pdf' }).click();
  await expect(page.locator('[data-page-number="1"][data-rendered="true"]')).toBeVisible();

  for (const panel of ['Page Thumbnails', 'Bookmarks', 'Attachments', 'Layers']) {
    const region = page.getByRole('region', { name: panel });
    if (!(await region.isVisible())) await page.getByRole('button', { name: panel }).click();
    await expect(region).toBeVisible();
  }

  await page.keyboard.press('Control+f');
  await page.getByRole('searchbox', { name: 'Find in document' }).fill('about');
  await expect(page.getByText('1 of 2')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  await page.keyboard.press('Escape');

  expect(requested.length).toBeGreaterThan(0);
  const remote = requested.filter((url) => !LOCAL_SCHEMES.has(new URL(url).protocol));
  expect(remote).toEqual([]);
});

test('the main process cannot reach the network either', async () => {
  const outcome = await app.evaluate(async ({ net }) => {
    try {
      await net.fetch('https://example.org/');
      return 'reached';
    } catch (error) {
      return String(error);
    }
  });
  expect(outcome).toMatch(/ERR_BLOCKED_BY_CLIENT/);
});

test('the window cannot fetch from the network', async () => {
  const outcome = await page.evaluate(async () => {
    try {
      await fetch('https://example.org/');
      return 'reached';
    } catch (error) {
      return String(error);
    }
  });
  expect(outcome).not.toBe('reached');
});
