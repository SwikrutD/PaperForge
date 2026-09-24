import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Locator,
  type Page,
} from '@playwright/test';
import electronBinary from 'electron';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildFormPdf } from '../fixtures/forms';

const mainBundle = path.resolve('.vite', 'build', 'main.js');

let app: ElectronApplication;
let page: Page;
let sandbox = '';
let documentPath = '';

/** How many annotations of a kind the file on disk carries. */
async function annotationsOnDisk(filePath: string, subtype: string): Promise<number> {
  const task = getDocument({ data: new Uint8Array(await fs.readFile(filePath)) });
  const pdf = await task.promise;
  const annotations = await (await pdf.getPage(1)).getAnnotations();
  const count = annotations.filter(
    (entry: { subtype?: string }) => entry.subtype === subtype,
  ).length;
  await task.destroy();
  return count;
}

function toolbar(): Locator {
  return page.getByRole('toolbar', { name: 'Fill and sign' });
}

function dialog(): Locator {
  return page.getByRole('dialog');
}

async function openFillSign(): Promise<void> {
  if ((await toolbar().count()) === 0) await page.keyboard.press('Control+Shift+F');
  await expect(toolbar()).toBeVisible();
}

function stamps(): Locator {
  return page.getByLabel('Page 1').locator('[data-annotation]');
}

/**
 * Puts whatever is staged down, in an empty part of the page.
 *
 * The fields are drawn down the left of the fixture, so the right-hand side is
 * free; the point is taken as a fraction so it stays on screen whatever the
 * window is sized to.
 */
async function placeOnPage(downwards = 0.25): Promise<void> {
  const box = await page.getByLabel('Page 1').boundingBox();
  if (box === null) throw new Error('the page has no box on screen');
  await page.mouse.click(box.x + box.width * 0.62, box.y + box.height * downwards);
}

test.beforeAll(async () => {
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'paperforge-sign-'));
  app = await electron.launch({
    executablePath: electronBinary as unknown as string,
    args: [mainBundle, `--user-data-dir=${path.join(sandbox, 'profile')}`],
  });
  page = await app.firstWindow();
  await page.waitForSelector('[data-focus-region="workspace"]');

  const recovery = page.getByRole('dialog').filter({ hasText: 'Recover documents' });
  if ((await recovery.count()) > 0) await recovery.getByRole('button', { name: 'Discard' }).click();

  documentPath = path.join(sandbox, 'Agreement.pdf');
  await fs.writeFile(documentPath, await buildFormPdf());

  await page.evaluate(
    (target: string) => window.paperforge.invoke('files:openPaths', { paths: [target] }),
    documentPath,
  );
  await page.getByRole('button', { name: 'Open Agreement.pdf' }).click();
  await expect(page.getByLabel('Page 1')).toBeVisible();
  await openFillSign();
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

test('a typed signature is placed on the page as a mark', async () => {
  await toolbar().getByRole('button', { name: 'Signature' }).click();
  await expect(dialog()).toContainText('not a certificate-based signature');

  await dialog().getByRole('tab', { name: 'Type' }).click();
  await dialog().getByLabel('Name', { exact: true }).fill('Grace Hopper');
  await dialog().getByRole('button', { name: 'Place it' }).click();

  await expect(toolbar()).toContainText('Click the page where the mark should go');
  await placeOnPage();

  await expect(stamps()).toHaveCount(1);
  await expect(page.getByLabel('Unsaved changes')).toBeVisible();
});

test('a drawn signature is placed too, and keeps only what was drawn', async () => {
  await toolbar().getByRole('button', { name: 'Initials' }).click();
  const canvas = dialog().getByLabel('Draw your initials here');
  const box = await canvas.boundingBox();
  if (box === null) throw new Error('the drawing surface has no box on screen');

  // A short scribble in the middle of the surface.
  await page.mouse.move(box.x + 40, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + 90, box.y + 30, { steps: 6 });
  await page.mouse.move(box.x + 140, box.y + 90, { steps: 6 });
  await page.mouse.up();

  await dialog().getByRole('button', { name: 'Place it' }).click();
  await placeOnPage(0.45);

  await expect(stamps()).toHaveCount(2);
});

test('the marks are written into the file and come back on reopening', async () => {
  await page.keyboard.press('Control+s');
  await expect(page.getByText(/Agreement\.pdf was saved/)).toBeVisible();

  expect(await annotationsOnDisk(documentPath, 'Stamp')).toBe(2);

  await page.keyboard.press('Control+w');
  await page.getByRole('button', { name: 'Open Agreement.pdf' }).click();
  await expect(page.getByLabel('Page 1')).toBeVisible();
  await openFillSign();
  await expect(stamps()).toHaveCount(2);
});

test('a mark can be picked up and moved, and taken off again', async () => {
  const before = await stamps().first().boundingBox();
  if (before === null) throw new Error('the mark has no box on screen');

  // Taken hold of near its left edge: a signature is wide, and the far end of
  // it may hang past the edge of the page.
  const grip = { x: before.x + 24, y: before.y + before.height / 2 };
  await page.mouse.move(grip.x, grip.y);
  await page.mouse.down();
  await page.mouse.move(grip.x - 80, grip.y, { steps: 8 });
  await page.mouse.up();

  await expect
    .poll(async () => {
      const box = await stamps().first().boundingBox();
      return box === null ? null : Math.round(box.x);
    })
    .toBeLessThan(Math.round(before.x) - 40);

  await page.keyboard.press('Control+z');
  await expect
    .poll(async () => {
      const box = await stamps().first().boundingBox();
      return box === null ? null : Math.round(box.x);
    })
    .toBe(Math.round(before.x));
});

test("today's date is placed as text, not as a picture", async () => {
  await toolbar().getByRole('button', { name: 'Date' }).click();

  const box = await page.getByLabel('Page 1').boundingBox();
  if (box === null) throw new Error('the page has no box on screen');

  // Below the marks already placed, and inside the window whatever its size.
  const windowHeight = await page.evaluate(() => window.innerHeight);
  const y = Math.min(box.y + box.height * 0.72, windowHeight - 140);
  await page.mouse.move(box.x + box.width * 0.55, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.9, y + 40, { steps: 6 });
  await page.mouse.up();

  // The box opens with the date already in it.
  const editor = page.getByLabel('Comment text');
  await expect(editor).toHaveValue(new RegExp(String(new Date().getFullYear())));
});

test('a signature is kept only when the reader asks for it', async () => {
  await page.keyboard.press('Escape');
  await toolbar().getByRole('button', { name: 'Signature' }).click();
  // Nothing has been kept, so the dialog offers nothing to reuse.
  await expect(dialog().getByText('Kept on this computer')).toHaveCount(0);

  await dialog().getByRole('tab', { name: 'Type' }).click();
  await dialog().getByLabel('Name', { exact: true }).fill('Ada Lovelace');
  await dialog()
    .getByRole('checkbox', { name: /Keep this signature/ })
    .check();
  await dialog().getByRole('button', { name: 'Place it' }).click();
  await placeOnPage(0.65);

  await toolbar().getByRole('button', { name: 'Signature' }).click();
  await expect(dialog().getByText('Kept on this computer')).toBeVisible();
  await expect(dialog().getByRole('button', { name: 'Forget Ada Lovelace' })).toBeVisible();

  await dialog().getByRole('button', { name: 'Forget Ada Lovelace' }).click();
  await expect(dialog().getByRole('button', { name: 'Forget Ada Lovelace' })).toHaveCount(0);
  await page.keyboard.press('Escape');
});
