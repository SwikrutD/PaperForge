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
import { DEFAULT_ANNOTATION_STYLE } from '../../src/shared/schemas/annotation';
import { PdfLibMutationEngine } from '../../src/pdf/mutate/pdfLibEngine';
import { buildPdf } from '../fixtures/pdf';
import { pngPixel } from '../fixtures/images';

/**
 * The keys and handles of the image editor, and the handles on stamps:
 * pasting, deleting, nudging, turning, cropping and duplicating, each undone
 * with Ctrl+Z.
 */

const mainBundle = path.resolve('.vite', 'build', 'main.js');

let app: ElectronApplication;
let page: Page;
let sandbox = '';

function imagesOn(pageNumber: number): Locator {
  return page.getByLabel(`Page ${String(pageNumber)}`).locator('[data-image]');
}

function stamps(): Locator {
  return page.getByLabel('Page 1').locator('[data-annotation]');
}

function properties(): Locator {
  return page.getByRole('region', { name: 'Properties and tools' });
}

async function centreOf(locator: Locator): Promise<{ x: number; y: number }> {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  if (box === null) throw new Error('nothing on screen to point at');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function dragBy(
  locator: Locator,
  by: { x: number; y: number },
  shift = false,
): Promise<void> {
  const from = await centreOf(locator);
  await page.mouse.move(from.x, from.y);
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.down();
  await page.mouse.move(from.x + by.x, from.y + by.y, { steps: 8 });
  await page.mouse.up();
  if (shift) await page.keyboard.up('Shift');
}

async function openImageEditor(): Promise<void> {
  const toolbar = page.getByRole('toolbar', { name: 'Editing' });
  if ((await toolbar.count()) === 0) await page.keyboard.press('Control+e');
  await expect(toolbar).toBeVisible();
  await toolbar.getByRole('button', { name: 'Edit images' }).click();
}

async function closeEditor(): Promise<void> {
  const toolbar = page.getByRole('toolbar', { name: 'Editing' });
  if ((await toolbar.count()) > 0) await page.keyboard.press('Control+e');
  await expect(toolbar).toHaveCount(0);
}

test.beforeAll(async () => {
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'paperforge-transforms-'));
  app = await electron.launch({
    executablePath: electronBinary as unknown as string,
    args: [mainBundle, `--user-data-dir=${path.join(sandbox, 'profile')}`],
  });
  page = await app.firstWindow();
  await page.waitForSelector('[data-focus-region="workspace"]');

  const recovery = page.getByRole('dialog').filter({ hasText: 'Recover documents' });
  if ((await recovery.count()) > 0) await recovery.getByRole('button', { name: 'Discard' }).click();

  // A picture, a caption, and a stamp PaperForge made, well apart.
  const engine = new PdfLibMutationEngine();
  const { bytes } = await engine.apply(
    new Uint8Array(
      buildPdf({
        pages: [
          {
            text: 'A caption',
            image: { pixels: { width: 16, height: 8 }, x: 120, y: 420, width: 200, height: 100 },
          },
        ],
      }),
    ),
    [
      {
        kind: 'addAnnotations',
        annotations: [
          {
            pageNumber: 1,
            geometry: { kind: 'stamp', rect: { x: 360, y: 200, width: 160, height: 50 } },
            style: DEFAULT_ANNOTATION_STYLE,
            contents: '',
            author: 'Tester',
            subject: '',
            stampLabel: 'Approved',
          },
        ],
      },
    ],
  );
  const documentPath = path.join(sandbox, 'Transforms.pdf');
  await fs.writeFile(documentPath, bytes);

  await page.evaluate(
    (target: string) => window.paperforge.invoke('files:openPaths', { paths: [target] }),
    documentPath,
  );
  await page.getByRole('button', { name: 'Open Transforms.pdf' }).click();
  await expect(page.getByText('A caption')).toBeVisible();
});

test.afterAll(async () => {
  await app?.close();
  await fs.rm(sandbox, { recursive: true, force: true }).catch(() => undefined);
});

test('a stamp PaperForge made turns from its handle, and undo turns it back', async () => {
  await stamps().first().click();
  const frame = page.locator('[data-stamp-frame]');
  await expect(frame).toBeVisible();

  // From the handle above the stamp, swing round to its left: a quarter turn.
  const handle = frame.locator('[data-stamp-handle="Rotate"]');
  const middle = await centreOf(stamps().first());
  const grip = await centreOf(handle);
  await page.mouse.move(grip.x, grip.y);
  await page.keyboard.down('Shift');
  await page.mouse.down();
  await page.mouse.move(middle.x - (middle.y - grip.y), middle.y, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up('Shift');

  await expect(page.getByLabel('Unsaved changes')).toBeVisible();
  await stamps().first().click();
  await expect(page.locator('[data-stamp-frame]')).toHaveAttribute('style', /rotate\(-90deg\)/);

  await page.keyboard.press('Control+z');
  await expect(page.getByLabel('Unsaved changes')).toBeHidden();
});

test('a stamp is duplicated beside itself, as one undo', async () => {
  await stamps().first().click();
  await page.locator('[data-stamp-frame]').getByRole('button', { name: 'Duplicate' }).click();
  await expect(stamps()).toHaveCount(2);

  await page.keyboard.press('Control+z');
  await expect(stamps()).toHaveCount(1);
});

test('Delete takes the selected image off the page, and undo puts it back', async () => {
  await openImageEditor();
  await imagesOn(1).first().click();
  await page.keyboard.press('Delete');
  await expect(imagesOn(1)).toHaveCount(0);

  await page.keyboard.press('Control+z');
  await expect(imagesOn(1)).toHaveCount(1);
});

test('the arrow keys nudge the selected image, as one change', async () => {
  await imagesOn(1).first().click();
  const before = await centreOf(imagesOn(1).first());
  for (let step = 0; step < 4; step += 1) await page.keyboard.down('ArrowRight');
  await page.keyboard.up('ArrowRight');

  await expect
    .poll(async () => (await centreOf(imagesOn(1).first())).x)
    .toBeGreaterThan(before.x + 2);

  // One press, held or repeated, is one undo.
  await page.keyboard.press('Control+z');
  await expect
    .poll(async () => Math.round((await centreOf(imagesOn(1).first())).x))
    .toBe(Math.round(before.x));
});

test('the rotation handle turns the image, in 15° steps with Shift', async () => {
  await imagesOn(1).first().click();
  const handle = imagesOn(1).first().locator('[data-handle="Rotate"]');
  const middle = await centreOf(imagesOn(1).first());
  const grip = await centreOf(handle);
  await page.mouse.move(grip.x, grip.y);
  await page.keyboard.down('Shift');
  await page.mouse.down();
  await page.mouse.move(middle.x - (middle.y - grip.y), middle.y + 3, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up('Shift');

  await expect(properties()).toContainText('90°');
  await page.keyboard.press('Control+z');
  await expect(properties()).toContainText('0°');
});

test('the crop is dragged on the page and kept with Enter', async () => {
  await imagesOn(1).first().click();
  await properties().getByRole('button', { name: 'Crop on page' }).click();
  const crop = imagesOn(1).first().locator('[data-crop-handle="Left"]');
  await dragBy(crop, { x: 40, y: 0 });
  await page.keyboard.press('Enter');

  await expect(properties().getByRole('button', { name: 'Reset crop' })).toBeEnabled();
  await page.keyboard.press('Control+z');
  await expect(properties().getByRole('button', { name: 'Reset crop' })).toBeDisabled();
});

test('Ctrl+V pastes the picture on the clipboard, selected, and undo takes it away', async () => {
  const picture = [...pngPixel(40, 20)];
  await app.evaluate(({ clipboard }, bytes: number[]) => {
    const png = new Blob([Uint8Array.from(bytes)], { type: 'image/png' });
    clipboard.read = () =>
      Promise.resolve([{ types: ['image/png'], getType: () => Promise.resolve(png) }] as never);
  }, picture);

  await imagesOn(1).first().click();
  await page.keyboard.press('Control+v');
  await expect(imagesOn(1)).toHaveCount(2);
  await expect(properties()).toContainText('40 × 20');
  await expect(properties()).toContainText('By PaperForge');

  await page.keyboard.press('Control+z');
  await expect(imagesOn(1)).toHaveCount(1);
  await closeEditor();
});
