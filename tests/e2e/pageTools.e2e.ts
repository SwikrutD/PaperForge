import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Locator,
  type Page,
} from '@playwright/test';
import electronBinary from 'electron';
import { PDFDocument, PDFName, PDFNumber, PDFRawStream, StandardFonts } from 'pdf-lib';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { threePageDocument } from '../fixtures/pdf';

/**
 * The page tools of Segment 16, driven in the real application: cropping by
 * a frame drawn on the page, checking and repairing a damaged file, and
 * optimising one.
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

test('Optimize PDF makes pictures smaller, measured, and undoably', async () => {
  // A photograph-like JPEG, made by the same codec the application uses.
  const jpeg = Buffer.from(
    await app.evaluate(({ nativeImage }) => {
      const size = 800;
      const bitmap = Buffer.alloc(size * size * 4);
      let state = 7;
      for (let index = 0; index < bitmap.length; index += 1) {
        state = (Math.imul(state, 1103515245) + 12345) >>> 0;
        bitmap[index] = index % 4 === 3 ? 255 : state >>> 24;
      }
      return nativeImage
        .createFromBitmap(bitmap, { width: size, height: size })
        .toJPEG(95)
        .toString('base64');
    }),
    'base64',
  );

  const source = await PDFDocument.create();
  const sheet = source.addPage([612, 792]);
  const font = await source.embedFont(StandardFonts.Helvetica);
  sheet.drawText('Holiday photographs', { x: 72, y: 720, size: 18, font });
  const picture = await source.embedJpg(jpeg);
  // 800 pixels across 100 points: 576 dpi.
  sheet.drawImage(picture, { x: 72, y: 500, width: 100, height: 100 });
  const photosPath = path.join(sandbox, 'Photos.pdf');
  await fs.writeFile(photosPath, await source.save());
  const before = (await fs.stat(photosPath)).size;

  await app.evaluate(({ dialog: electronDialog }, target: string) => {
    electronDialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [target] });
  }, photosPath);
  await page.keyboard.press('Control+o');
  await expect(page.getByRole('tab', { name: /Photos\.pdf/ })).toBeVisible();
  await expect(onPage(1).getByText('Holiday photographs')).toBeVisible();

  await runCommand('Optimize PDF');
  const dialog = page.getByRole('dialog', { name: 'Optimize PDF' });
  await expect(dialog).toContainText('Drawn at 576 dpi');
  await dialog.getByRole('radio', { name: /Balanced/ }).check();
  await dialog.getByRole('button', { name: 'Optimize' }).click();
  await expect(dialog.locator('[data-optimize-result="applied"]')).toContainText('% smaller');
  await expect(dialog).toContainText('1 picture made smaller');
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByLabel('Unsaved changes')).toBeVisible();

  await page.keyboard.press('Control+s');
  await expect(page.getByLabel('Unsaved changes')).toHaveCount(0);
  const after = (await fs.stat(photosPath)).size;
  expect(after).toBeLessThan(before / 4);

  // 150 dpi across 100 points, still a JPEG, and the text untouched.
  const saved = await PDFDocument.load(await fs.readFile(photosPath));
  const images = saved.context
    .enumerateIndirectObjects()
    .map(([, object]) => object)
    .filter(
      (object): object is PDFRawStream =>
        object instanceof PDFRawStream &&
        object.dict.lookup(PDFName.of('Subtype')) === PDFName.of('Image'),
    );
  expect(images).toHaveLength(1);
  expect(images[0]?.dict.lookup(PDFName.of('Width'), PDFNumber).asNumber()).toBe(208);
  expect(images[0]?.dict.lookup(PDFName.of('Filter'))).toBe(PDFName.of('DCTDecode'));
  await expect(onPage(1).getByText('Holiday photographs')).toBeVisible();

  // And it was one step: undo brings the picture back as it was.
  await page.keyboard.press('Control+z');
  await expect(page.getByLabel('Unsaved changes')).toBeVisible();
});
