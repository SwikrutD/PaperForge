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
import { buildPdf } from '../fixtures/pdf';

/**
 * The built application is driven unpackaged: the packaged build has the Node
 * inspector fuse disabled, which is exactly what stops anything — including a
 * test runner — from attaching to it. The code, the app:// renderer and the
 * main process are the same; only the fuses differ.
 *
 * Playwright runs from the repository root.
 */
const mainBundle = path.resolve('.vite', 'build', 'main.js');

interface OpenEnvelope {
  ok: boolean;
  data: { sessions: Array<{ id: string }>; failures: Array<{ code: string }> };
}

let app: ElectronApplication;
let page: Page;
let sandbox = '';
let documentPath = '';

/** Everything this run touches lives in a throwaway profile, never the user's. */
test.beforeAll(async () => {
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'paperforge-e2e-'));
  documentPath = path.join(sandbox, 'Rapport final é.pdf');
  await fs.writeFile(
    documentPath,
    buildPdf({ pages: [{ text: 'Opened by the end-to-end test' }] }),
  );

  app = await electron.launch({
    executablePath: electronBinary as unknown as string,
    args: [mainBundle, `--user-data-dir=${path.join(sandbox, 'profile')}`],
  });
  page = await app.firstWindow();
  await page.waitForSelector('[data-focus-region="workspace"]');
});

test.afterAll(async () => {
  await app?.close();
  // Chromium releases its profile files a moment after the process exits.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await fs.rm(sandbox, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
});

test('starts on the home screen with the shell in place', async () => {
  await expect(page.getByRole('heading', { name: 'PaperForge', level: 1 })).toBeVisible();
  await expect(page.getByRole('menubar', { name: 'Main menu' })).toBeVisible();
  await expect(page.getByText('No recent files')).toBeVisible();
});

test('the main process opens a real PDF and refuses one that is not', async () => {
  const notPdf = path.join(sandbox, 'notes.txt');
  await fs.writeFile(notPdf, 'plain text, not a document');

  const result = (await page.evaluate(
    (paths: string[]) => window.paperforge.invoke('files:openPaths', { paths }),
    [documentPath, notPdf],
  )) as OpenEnvelope;

  expect(result.ok).toBe(true);
  expect(result.data.sessions).toHaveLength(1);
  expect(result.data.failures.map((failure) => failure.code)).toEqual(['pdf/invalid']);
});

test('opening from the recent list shows the document as a tab', async () => {
  // The open above put the file in the recent list, which arrived as an event.
  await page.getByRole('button', { name: 'Open Rapport final é.pdf' }).click();

  await expect(page.getByRole('tab', { name: 'Rapport final é.pdf' })).toBeVisible();
  await expect(page.getByText('Opened by the end-to-end test')).toBeVisible();
  await expect(page.getByText('of 1')).toBeVisible();
});

test('the properties panel reports the file it came from', async () => {
  await page.keyboard.press('F4');
  await expect(page.getByRole('region', { name: 'Properties and tools' })).toBeVisible();
  await expect(page.getByText(documentPath)).toBeVisible();
  await expect(page.getByText('1.7')).toBeVisible();
  await page.keyboard.press('F4');
});

test('closing the tab returns to the home screen', async () => {
  await page.getByRole('button', { name: 'Close Rapport final é.pdf' }).click();

  await expect(page.getByRole('tab', { name: 'Rapport final é.pdf' })).toBeHidden();
  await expect(page.getByRole('heading', { name: 'PaperForge', level: 1 })).toBeVisible();
});

test('a file that has gone missing is reported, not silently ignored', async () => {
  await fs.rm(documentPath);

  // The recent list lives on the home screen, so nothing may be open.
  for (let guard = 0; guard < 10 && (await page.getByRole('tab').count()) > 0; guard += 1) {
    await page.keyboard.press('Control+w');
    await page.waitForTimeout(150);
  }
  await page.getByRole('button', { name: 'Open Rapport final é.pdf' }).click();

  await expect(page.getByText('The file could not be found.')).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(0);
});
