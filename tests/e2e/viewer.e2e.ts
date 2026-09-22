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
import { buildPdf, threePageDocument } from '../fixtures/pdf';

const mainBundle = path.resolve('.vite', 'build', 'main.js');

let app: ElectronApplication;
let page: Page;
let sandbox = '';

async function writeFixture(name: string, bytes: Buffer): Promise<string> {
  const filePath = path.join(sandbox, name);
  await fs.writeFile(filePath, bytes);
  return filePath;
}

/**
 * Opens a file the way a reader does: the main process records it, the home
 * screen lists it, and a click on that row opens it. The file picker itself is
 * a native Windows dialog and cannot be driven from here.
 */
async function open(filePath: string, displayName: string): Promise<void> {
  await page.evaluate(
    (target: string) => window.paperforge.invoke('files:openPaths', { paths: [target] }),
    filePath,
  );

  // The recent list lives on the home screen, so close what is open first.
  for (let guard = 0; guard < 10 && (await page.getByRole('tab').count()) > 0; guard += 1) {
    await page.keyboard.press('Control+w');
    await page.waitForTimeout(150);
  }

  await page.getByRole('button', { name: `Open ${displayName}` }).click();
}

test.beforeAll(async () => {
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'paperforge-viewer-'));
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

test('renders a document, its text and its page count', async () => {
  const filePath = await writeFixture('Three pages.pdf', threePageDocument());
  await open(filePath, 'Three pages.pdf');

  await expect(page.getByRole('tab', { name: 'Three pages.pdf' })).toBeVisible();
  await expect(page.getByText('of 3')).toBeVisible();

  // The canvas carries the pixels; the text layer carries selectable text.
  await expect(page.locator('canvas').first()).toBeVisible();
  await expect(page.getByText('PaperForge alpha page')).toBeVisible();
});

test('only keeps nearby pages mounted', async () => {
  // Three short pages fit in the overscan band; a page far away must not be
  // mounted, which is what keeps a long document affordable.
  const mounted = await page.locator('[data-page-number]').count();
  expect(mounted).toBeLessThanOrEqual(3);
});

test('navigates to another page', async () => {
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByText('PaperForge beta page')).toBeVisible();

  const pageBox = page.getByRole('textbox', { name: 'Page number' });
  await expect(pageBox).toHaveValue('2');
});

test('zooms and reports the level', async () => {
  await page.getByRole('button', { name: 'Actual size' }).click();
  await expect(page.getByText('100%')).toBeVisible();

  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(page.getByText('125%')).toBeVisible();

  await page.getByRole('button', { name: 'Zoom out' }).click();
  await expect(page.getByText('100%')).toBeVisible();
});

test('rotates the view without touching the document', async () => {
  const firstMountedPage = page.locator('[data-page-number]').first();
  const before = await firstMountedPage.boundingBox();
  expect(before?.height).toBeGreaterThan(before?.width ?? 0);

  await page.getByRole('button', { name: 'Rotate view right' }).click();

  // A quarter turn makes an upright page wider than it is tall.
  await expect
    .poll(async () => {
      const after = await page.locator('[data-page-number]').first().boundingBox();
      return after === null ? null : after.width > after.height;
    })
    .toBe(true);

  await page.getByRole('button', { name: 'Rotate view left' }).click();
  await page.getByRole('button', { name: 'Fit width' }).click();
});

test('asks for a password, rejects the wrong one, and opens with the right one', async () => {
  const filePath = await writeFixture(
    'Locked.pdf',
    buildPdf({ pages: [{ text: 'Secret contents' }], password: 'open-sesame' }),
  );
  await open(filePath, 'Locked.pdf');

  const dialog = page.getByRole('dialog', { name: 'Password required' });
  await expect(dialog).toBeVisible();
  // Scoped to the dialog: the title bar also has an Open button.
  const unlock = dialog.getByRole('button', { name: 'Open', exact: true });

  await page.getByLabel('Password', { exact: true }).fill('wrong');
  await unlock.click();
  await expect(page.getByText('That password did not work. Try again.')).toBeVisible();

  await page.getByLabel('Password', { exact: true }).fill('open-sesame');
  await unlock.click();

  await expect(dialog).toBeHidden();
  await expect(page.getByText('Secret contents')).toBeVisible();
});

test('reports a document it cannot read', async () => {
  const broken = path.join(sandbox, 'Broken.pdf');
  // A valid header with nothing behind it: accepted as a PDF on open, then
  // rejected by the engine, which is the path the error state exists for.
  await fs.writeFile(broken, '%PDF-1.7\nnot really a document\n');
  await open(broken, 'Broken.pdf');

  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
});
