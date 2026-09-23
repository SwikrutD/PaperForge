import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Locator,
  type Page,
} from '@playwright/test';
import electronBinary from 'electron';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildPdf } from '../fixtures/pdf';
import { pngPixel } from '../fixtures/images';

const mainBundle = path.resolve('.vite', 'build', 'main.js');

let app: ElectronApplication;
let page: Page;
let sandbox = '';
let documentPath = '';
let imagePath = '';

/** The image boxes the editor draws on a page. */
function imagesOn(pageNumber: number): Locator {
  return page.getByLabel(`Page ${String(pageNumber)}`).locator('[data-image]');
}

function properties(): Locator {
  return page.getByRole('region', { name: 'Properties and tools' });
}

async function openImageEditor(): Promise<void> {
  const toolbar = page.getByRole('toolbar', { name: 'Editing' });
  if ((await toolbar.count()) === 0) await page.keyboard.press('Control+e');
  await expect(toolbar).toBeVisible();
  await toolbar.getByRole('button', { name: 'Edit images' }).click();
}

/**
 * The box an image occupies on screen, as the page shows it.
 *
 * A change rewrites the page, so for a moment there is nothing to measure;
 * waiting for the box back is part of what every assertion here does.
 */
async function boxOf(locator: Locator): Promise<{ x: number; y: number; width: number }> {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  if (box === null) throw new Error('the image has no box on screen');
  return { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width) };
}

/** One measurement of the image, or null while the page is being redrawn. */
async function measure(locator: Locator, what: 'x' | 'width'): Promise<number | null> {
  const box = await locator.boundingBox().catch(() => null);
  return box === null ? null : Math.round(what === 'x' ? box.x : box.width);
}

test.beforeAll(async () => {
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'paperforge-images-'));
  app = await electron.launch({
    executablePath: electronBinary as unknown as string,
    args: [mainBundle, `--user-data-dir=${path.join(sandbox, 'profile')}`],
  });
  page = await app.firstWindow();
  await page.waitForSelector('[data-focus-region="workspace"]');

  const recovery = page.getByRole('dialog').filter({ hasText: 'Recover documents' });
  if ((await recovery.count()) > 0) await recovery.getByRole('button', { name: 'Discard' }).click();

  imagePath = path.join(sandbox, 'Replacement.png');
  await fs.writeFile(imagePath, pngPixel(24, 12));

  documentPath = path.join(sandbox, 'Pictures.pdf');
  await fs.writeFile(
    documentPath,
    buildPdf({
      pages: [
        {
          text: 'A caption',
          image: { pixels: { width: 16, height: 8 }, x: 120, y: 480, width: 200, height: 100 },
        },
      ],
    }),
  );

  await page.evaluate(
    (target: string) => window.paperforge.invoke('files:openPaths', { paths: [target] }),
    documentPath,
  );
  await page.getByRole('button', { name: 'Open Pictures.pdf' }).click();
  await expect(page.getByText('A caption')).toBeVisible();
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

test('the editor puts a box around the image the page draws', async () => {
  await openImageEditor();

  await expect(imagesOn(1)).toHaveCount(1);
  await expect(imagesOn(1).first()).toHaveAttribute('title', '16 × 8 pixels');
});

test('selecting it says how big it is, and grows handles', async () => {
  await imagesOn(1).first().click();

  await expect(properties()).toContainText('16 × 8');
  await expect(properties()).toContainText('200 × 100 pt');
  await expect(imagesOn(1).first().locator('[data-handle]')).toHaveCount(8);
});

test('dragging it moves it, as one undoable change', async () => {
  const before = await boxOf(imagesOn(1).first());

  await page.mouse.move(before.x + 40, before.y + 30);
  await page.mouse.down();
  await page.mouse.move(before.x + 90, before.y + 30, { steps: 8 });
  await page.mouse.up();

  await expect(page.getByLabel('Unsaved changes')).toBeVisible();
  await expect.poll(() => measure(imagesOn(1).first(), 'x')).toBeGreaterThan(before.x + 30);

  // It is still the same size: moving is not resizing.
  await expect.poll(() => measure(imagesOn(1).first(), 'width')).toBe(before.width);

  await page.keyboard.press('Control+z');
  await expect.poll(() => measure(imagesOn(1).first(), 'x')).toBe(before.x);
  await expect(page.getByLabel('Unsaved changes')).toBeHidden();
});

test('dragging a handle resizes it', async () => {
  await imagesOn(1).first().click();
  const before = await boxOf(imagesOn(1).first());
  const handle = imagesOn(1).first().locator('[data-handle="Bottom right"]');
  const grip = await handle.boundingBox();
  if (grip === null) throw new Error('the handle has no box on screen');

  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 + 60, grip.y + grip.height / 2, { steps: 8 });
  await page.mouse.up();

  await expect.poll(() => measure(imagesOn(1).first(), 'width')).toBeGreaterThan(before.width + 30);
  // The corner that was not dragged stayed where it was.
  await expect.poll(() => measure(imagesOn(1).first(), 'x')).toBe(before.x);
});

test('turning it a quarter swaps how wide and how tall it is', async () => {
  const before = await boxOf(imagesOn(1).first());
  await properties().getByRole('button', { name: 'Turn right' }).click();

  await expect(properties()).toContainText('270°');
  await expect.poll(() => measure(imagesOn(1).first(), 'width')).toBeLessThan(before.width);

  await properties().getByRole('button', { name: 'Turn left' }).click();
  await expect(properties()).toContainText('0°');
});

test('the caption is untouched by everything done to the image', async () => {
  await expect(page.getByLabel('Page 1').getByText('A caption')).toBeVisible();
});

test('replacing it draws a different picture in the same box', async () => {
  const before = await boxOf(imagesOn(1).first());
  await app.evaluate(({ dialog }, target: string) => {
    dialog.showOpenDialog = () =>
      Promise.resolve({ canceled: false, filePaths: [target] } as never);
  }, imagePath);

  await properties().getByRole('button', { name: 'Replace' }).click();

  await expect(properties()).toContainText('24 × 12');
  await expect(properties()).toContainText('By PaperForge');
  await expect.poll(() => measure(imagesOn(1).first(), 'width')).toBe(before.width);
});

test('writing it out saves a file', async () => {
  const target = path.join(sandbox, 'Written out.png');
  await app.evaluate(({ dialog }, chosen: string) => {
    dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: chosen } as never);
  }, target);

  await properties().getByRole('button', { name: 'Save image' }).click();
  const toast = page.getByRole('status').filter({ hasText: 'Image saved' });
  await expect(toast).toBeVisible();

  const written = await fs.readFile(target);
  expect([...written.subarray(0, 4)]).toEqual([137, 80, 78, 71]);

  // The message sits over the corner of the panel; the buttons beneath it are
  // the next thing to be used.
  await toast.getByRole('button', { name: 'Dismiss' }).click();
});

test('deleting it takes it off the page and leaves the caption', async () => {
  await properties().getByRole('button', { name: 'Delete' }).click();

  await expect(imagesOn(1)).toHaveCount(0);
  await expect(page.getByLabel('Page 1').getByText('A caption')).toBeVisible();
});

test('an image can be added, and survives a save and reopen', async () => {
  await app.evaluate(({ dialog }, target: string) => {
    dialog.showOpenDialog = () =>
      Promise.resolve({ canceled: false, filePaths: [target] } as never);
  }, imagePath);

  await page
    .getByRole('toolbar', { name: 'Editing' })
    .getByRole('button', { name: 'Add image' })
    .click();
  const pageBox = await page.getByLabel('Page 1').boundingBox();
  if (pageBox === null) throw new Error('the page has no box on screen');
  await page.mouse.click(pageBox.x + 120, pageBox.y + 160);

  await expect(imagesOn(1)).toHaveCount(1);

  await page.keyboard.press('Control+s');
  await expect(page.getByText(/Pictures\.pdf was saved/)).toBeVisible();

  await page.keyboard.press('Control+w');
  await page.getByRole('button', { name: 'Open Pictures.pdf' }).click();
  // The editor only has a toolbar once there is a document under it.
  await expect(page.getByLabel('Page 1').getByText('A caption')).toBeVisible();
  await openImageEditor();
  await expect(imagesOn(1)).toHaveCount(1);
  await expect(page.getByLabel('Page 1').getByText('A caption')).toBeVisible();
});
