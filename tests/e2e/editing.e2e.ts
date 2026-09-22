import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import electronBinary from 'electron';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { threePageDocument } from '../fixtures/pdf';

const mainBundle = path.resolve('.vite', 'build', 'main.js');

let app: ElectronApplication;
let page: Page;
let sandbox = '';
let documentPath = '';

async function open(filePath: string, displayName: string): Promise<void> {
  await page.evaluate(
    (target: string) => window.paperforge.invoke('files:openPaths', { paths: [target] }),
    filePath,
  );
  for (let guard = 0; guard < 10 && (await page.getByRole('tab').count()) > 0; guard += 1) {
    await page.keyboard.press('Control+w');
    await page.waitForTimeout(150);
  }
  await page.getByRole('button', { name: `Open ${displayName}` }).click();
}

/** The first mounted page, which is how a rotation is visible from here. */
async function firstPageIsLandscape(): Promise<boolean> {
  const box = await page.locator('[data-page-number]').first().boundingBox();
  return box !== null && box.width > box.height;
}

/** What the file on disk says, read back with the render engine. */
async function pagesOnDisk(filePath: string): Promise<{ count: number; rotations: number[] }> {
  const task = getDocument({ data: new Uint8Array(await fs.readFile(filePath)) });
  const document = await task.promise;
  const rotations: number[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    rotations.push((await document.getPage(pageNumber)).rotate);
  }
  const count = document.numPages;
  await task.destroy();
  return { count, rotations };
}

test.beforeAll(async () => {
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'paperforge-editing-'));
  app = await electron.launch({
    executablePath: electronBinary as unknown as string,
    args: [mainBundle, `--user-data-dir=${path.join(sandbox, 'profile')}`],
  });
  page = await app.firstWindow();
  await page.waitForSelector('[data-focus-region="workspace"]');

  documentPath = path.join(sandbox, 'Editing.pdf');
  await fs.writeFile(documentPath, threePageDocument());
  await open(documentPath, 'Editing.pdf');
  await expect(page.getByText('PaperForge alpha page')).toBeVisible();
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

test('rotating a page changes the document, not just the view', async () => {
  expect(await firstPageIsLandscape()).toBe(false);
  const before = await fs.readFile(documentPath);

  await page.getByRole('button', { name: 'Rotate Page Right' }).click();

  // The viewer reloads the changed document and the page comes back turned.
  await expect.poll(async () => firstPageIsLandscape()).toBe(true);
  await expect(page.getByLabel('Unsaved changes')).toBeVisible();

  // Nothing has been written to the reader's file yet.
  expect(await fs.readFile(documentPath)).toEqual(before);
});

test('undo takes the change back and redo puts it again', async () => {
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(async () => firstPageIsLandscape()).toBe(false);
  await expect(page.getByLabel('Unsaved changes')).toBeHidden();

  await page.getByRole('button', { name: 'Redo' }).click();
  await expect.poll(async () => firstPageIsLandscape()).toBe(true);
  await expect(page.getByLabel('Unsaved changes')).toBeVisible();
});

test('deleting a page removes it, and undo brings it back', async () => {
  await expect(page.getByText('of 3')).toBeVisible();

  await page.getByRole('button', { name: 'Delete Page' }).click();
  await expect(page.getByText('of 2')).toBeVisible();

  await page.keyboard.press('Control+z');
  await expect(page.getByText('of 3')).toBeVisible();
});

test('saving writes the change, and the saved file reopens', async () => {
  await page.keyboard.press('Control+s');
  await expect(page.getByText(/Editing\.pdf was saved/)).toBeVisible();
  await expect(page.getByLabel('Unsaved changes')).toBeHidden();

  const saved = await pagesOnDisk(documentPath);
  expect(saved.count).toBe(3);
  expect(saved.rotations).toEqual([90, 0, 0]);
});

test('the saved document is what the viewer shows after reopening it', async () => {
  await page.keyboard.press('Control+w');
  await expect(page.getByRole('tab')).toHaveCount(0);

  await page.getByRole('button', { name: 'Open Editing.pdf' }).click();
  await expect(page.getByText('PaperForge alpha page')).toBeVisible();
  expect(await firstPageIsLandscape()).toBe(true);
});

test('revert goes back to the saved document and can be undone', async () => {
  await page.getByRole('button', { name: 'Delete Page' }).click();
  await expect(page.getByText('of 2')).toBeVisible();

  await page.getByRole('menuitem', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: 'Revert to Saved' }).click();

  await expect(page.getByText('of 3')).toBeVisible();
  await expect(page.getByLabel('Unsaved changes')).toBeHidden();

  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(page.getByText('of 2')).toBeVisible();
  await page.keyboard.press('Control+z');
});

test('a document with nothing to save says so instead of offering it', async () => {
  await page.keyboard.press('Control+s');
  await expect(page.getByText(/was saved/)).toBeVisible();

  const save = page.getByRole('button', { name: 'Save', exact: true });
  await expect(save).toBeDisabled();
  await expect(save).toHaveAttribute('title', 'This document has no unsaved changes.');
});

test('closing a changed document warns before discarding the changes', async () => {
  await page.getByRole('button', { name: 'Rotate Page Left' }).click();
  await expect(page.getByLabel('Unsaved changes')).toBeVisible();

  await page.keyboard.press('Control+w');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('This document has unsaved changes');

  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('tab')).toHaveCount(1);

  // And discarding really does close it.
  await page.keyboard.press('Control+w');
  await page.getByRole('button', { name: 'Close without saving' }).click();
  await expect(page.getByRole('tab')).toHaveCount(0);
});
