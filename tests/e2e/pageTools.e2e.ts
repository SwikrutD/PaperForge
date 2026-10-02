import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Locator,
  type Page,
} from '@playwright/test';
import electronBinary from 'electron';
import { PDFDocument } from 'pdf-lib';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { threePageDocument } from '../fixtures/pdf';

/**
 * The page tools of Segment 16, driven in the real application: drawing a
 * crop frame on a page and applying it.
 */

const mainBundle = path.resolve('.vite', 'build', 'main.js');

let app: ElectronApplication;
let page: Page;
let sandbox = '';
let documentPath = '';

function onPage(pageNumber: number): Locator {
  return page.locator(`[data-page-number="${String(pageNumber)}"]`);
}

async function runCommand(title: string): Promise<void> {
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder('Search commands').fill(title);
  await page
    .getByRole('option', { name: new RegExp(`^${title}`) })
    .first()
    .click();
}

async function cropBoxesOnDisk(filePath: string): Promise<Array<[number, number, number, number]>> {
  const document = await PDFDocument.load(await fs.readFile(filePath));
  return document.getPages().map((entry) => {
    const box = entry.getCropBox();
    return [box.x, box.y, box.width, box.height].map((value) => Math.round(value)) as [
      number,
      number,
      number,
      number,
    ];
  });
}

test.beforeAll(async () => {
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'paperforge-tools-'));
  app = await electron.launch({
    executablePath: electronBinary as unknown as string,
    args: [mainBundle, `--user-data-dir=${path.join(sandbox, 'profile')}`],
  });
  page = await app.firstWindow();
  await page.waitForSelector('[data-focus-region="workspace"]');

  const recovery = page.getByRole('dialog').filter({ hasText: 'Recover documents' });
  if ((await recovery.count()) > 0) await recovery.getByRole('button', { name: 'Discard' }).click();

  documentPath = path.join(sandbox, 'Pages to crop.pdf');
  await fs.writeFile(documentPath, threePageDocument());
  await page.evaluate(
    (target: string) => window.paperforge.invoke('files:openPaths', { paths: [target] }),
    documentPath,
  );
  await page.getByRole('button', { name: 'Open Pages to crop.pdf' }).click();
  await expect(onPage(1).getByText('PaperForge alpha page')).toBeVisible();
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

test('a frame drawn on a page crops every page to the same margins', async () => {
  await runCommand('Crop Pages');
  await expect(page.getByRole('toolbar', { name: 'Crop tools' })).toBeVisible();
  await expect(page.getByText('No frame yet.')).toBeVisible();

  const layer = onPage(1).locator('[data-crop-layer]');
  const box = await layer.boundingBox();
  if (box === null) throw new Error('the page is not on screen');
  await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.1);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.6, { steps: 10 });
  await page.mouse.up();

  await expect(onPage(1).locator('[data-crop-frame]')).toBeVisible();
  await expect(page.getByText('Margins on page 1')).toBeVisible();

  // Typed margins win over the drag, so the result is exact.
  for (const [edge, value] of [
    ['Top', '72'],
    ['Bottom', '144'],
    ['Left', '36'],
    ['Right', '36'],
  ] as const) {
    await page.getByLabel(edge, { exact: true }).fill(value);
  }
  await page.getByRole('radio', { name: 'All 3 pages' }).check();
  await page.getByRole('button', { name: 'Apply crop' }).click();
  await expect(page.getByLabel('Unsaved changes')).toBeVisible();

  await page.keyboard.press('Control+s');
  await expect(page.getByText(/Pages to crop\.pdf was saved/)).toBeVisible();
  expect(await cropBoxesOnDisk(documentPath)).toEqual([
    [36, 144, 540, 576],
    [36, 144, 540, 576],
    [36, 144, 540, 576],
  ]);
});

test('reset crop shows the whole page again', async () => {
  await page.getByRole('radio', { name: 'A page range' }).check();
  await page.getByRole('textbox', { name: 'Pages to crop' }).fill('2');
  await page.getByRole('button', { name: 'Reset crop' }).click();
  await expect(page.getByLabel('Unsaved changes')).toBeVisible();

  await page.keyboard.press('Control+s');
  await expect(page.getByLabel('Unsaved changes')).toHaveCount(0);
  const boxes = await cropBoxesOnDisk(documentPath);
  expect(boxes[1]).toEqual([0, 0, 612, 792]);
  expect(boxes[0]).toEqual([36, 144, 540, 576]);

  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('toolbar', { name: 'Crop tools' })).toHaveCount(0);
});

test('Check and Repair describes a damaged file and writes a repaired copy', async () => {
  // Every object is pushed along by a comment nobody accounted for: readers
  // still open it, by scanning, but its index is wrong.
  const bytes = threePageDocument();
  const header = bytes.indexOf('\n') + 1;
  const damagedPath = path.join(sandbox, 'Damaged.pdf');
  await fs.writeFile(
    damagedPath,
    Buffer.concat([
      bytes.subarray(0, header),
      Buffer.from('% padding nobody accounted for\n', 'latin1'),
      bytes.subarray(header),
    ]),
  );
  await app.evaluate(({ dialog: electronDialog }, target: string) => {
    electronDialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [target] });
  }, damagedPath);
  await page.keyboard.press('Control+o');
  await expect(page.getByRole('tab', { name: /Damaged\.pdf/ })).toBeVisible();
  await expect(onPage(1).getByText('PaperForge alpha page')).toBeVisible();

  await runCommand('Check and Repair');
  const dialog = page.getByRole('dialog', { name: 'Check and Repair' });
  await expect(dialog.locator('[data-repair-verdict="warnings"]')).toBeVisible();
  await expect(dialog).toContainText('not where the file says');

  const target = path.join(sandbox, 'Damaged repaired.pdf');
  await app.evaluate(({ dialog: electronDialog }, chosen: string) => {
    electronDialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: chosen });
  }, target);
  await dialog.getByRole('button', { name: 'Save a repaired copy…' }).click();
  await expect(page.getByText(/A repaired copy of 3 pages was written/)).toBeVisible();
  await expect(page.getByRole('tab', { name: /Damaged repaired\.pdf/ })).toBeVisible();

  const repaired = await PDFDocument.load(await fs.readFile(target));
  expect(repaired.getPageCount()).toBe(3);
  // The opened file is as it was.
  expect((await fs.readFile(damagedPath)).toString('latin1')).toContain('% padding nobody');
});
