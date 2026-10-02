import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Locator,
  type Page,
} from '@playwright/test';
import electronBinary from 'electron';
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { threePageDocument } from '../fixtures/pdf';

/**
 * The measuring tools in the real application: calibrating a scale from a
 * known length, measuring with it, and finding the measurement — value and
 * scale — in the saved file.
 */

const mainBundle = path.resolve('.vite', 'build', 'main.js');
const screenshots = process.env['PAPERFORGE_SCREENSHOTS'];

let app: ElectronApplication;
let page: Page;
let sandbox = '';
let documentPath = '';

function layer(): Locator {
  return page.locator('[data-measure-layer="1"]');
}

async function runCommand(title: string): Promise<void> {
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder('Search commands').fill(title);
  await page
    .getByRole('option', { name: new RegExp(`^${title}`) })
    .first()
    .click();
}

/** Clicks at fractions of the first page's width and height. */
async function clickAt(x: number, y: number): Promise<void> {
  const box = await layer().boundingBox();
  if (box === null) throw new Error('the page is not on screen');
  await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
}

function text(value: unknown): string | null {
  return value instanceof PDFString || value instanceof PDFHexString ? value.decodeText() : null;
}

test.beforeAll(async () => {
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'paperforge-measure-'));
  app = await electron.launch({
    executablePath: electronBinary as unknown as string,
    args: [mainBundle, `--user-data-dir=${path.join(sandbox, 'profile')}`],
  });
  page = await app.firstWindow();
  await page.waitForSelector('[data-focus-region="workspace"]');

  const recovery = page.getByRole('dialog').filter({ hasText: 'Recover documents' });
  if ((await recovery.count()) > 0) await recovery.getByRole('button', { name: 'Discard' }).click();

  documentPath = path.join(sandbox, 'Plan.pdf');
  await fs.writeFile(documentPath, threePageDocument());
  await page.evaluate(
    (target: string) => window.paperforge.invoke('files:openPaths', { paths: [target] }),
    documentPath,
  );
  await page.getByRole('button', { name: 'Open Plan.pdf' }).click();
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

test('calibrates a scale from a known length and measures with it', async () => {
  await runCommand('Measure');
  await expect(page.getByRole('toolbar', { name: 'Measuring tools' })).toBeVisible();
  await expect(page.locator('[data-measure-scale]')).toHaveText('Actual size, in in');

  await page.getByRole('button', { name: 'Calibrate scale' }).click();
  await clickAt(0.2, 0.3);
  await clickAt(0.6, 0.3);
  await page.getByRole('spinbutton', { name: 'Real length' }).fill('12');
  await page.locator('#calibration-unit').selectOption('ft');
  await page.getByRole('button', { name: 'Set scale' }).click();
  await expect(page.locator('[data-measure-scale]')).toContainText('Calibrated: 1 in = ');

  // The same two points measure exactly what the scale was set from.
  await page.getByRole('button', { name: 'Distance' }).click();
  await clickAt(0.2, 0.3);
  await clickAt(0.6, 0.3);
  const list = page.getByRole('region', { name: 'Measurements in this document' });
  await expect(list).toContainText('12 ft');

  // An area, closed with a double click.
  await page.getByRole('button', { name: 'Area' }).click();
  await clickAt(0.2, 0.35);
  await clickAt(0.6, 0.35);
  await clickAt(0.6, 0.45);
  const box = await layer().boundingBox();
  if (box === null) throw new Error('the page is not on screen');
  await page.mouse.dblclick(box.x + box.width * 0.2, box.y + box.height * 0.45);
  await expect(list).toContainText('sq ft');
  if (screenshots !== undefined) {
    await page.screenshot({ path: path.join(screenshots, 'measure.png') });
  }
});

test('saves measurements as dimension annotations that carry their scale', async () => {
  await page.keyboard.press('Control+s');
  await expect(page.getByLabel('Unsaved changes')).toHaveCount(0);

  const document = await PDFDocument.load(await fs.readFile(documentPath));
  const annots = document.getPage(0).node.Annots();
  const found = Array.from({ length: annots?.size() ?? 0 }, (_, index) =>
    annots?.lookup(index, PDFDict),
  ).map((dict) => {
    const measure = dict?.lookup(PDFName.of('Measure'), PDFDict);
    return {
      intent: dict?.lookup(PDFName.of('IT'))?.toString(),
      contents: text(dict?.lookup(PDFName.of('Contents'))),
      scale: text(measure?.lookup(PDFName.of('R'))),
    };
  });

  expect(found[0]).toMatchObject({ intent: '/LineDimension', contents: '12 ft' });
  expect(found[1]?.intent).toBe('/PolygonDimension');
  expect(found[1]?.contents).toMatch(/ sq ft$/);
  expect(found[0]?.scale).toMatch(/^1 in = [\d.]+ ft$/);

  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('toolbar', { name: 'Measuring tools' })).toHaveCount(0);
});
