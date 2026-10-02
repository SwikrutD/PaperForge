import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Locator,
  type Page,
} from '@playwright/test';
import electronBinary from 'electron';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildTaggedPdf } from '../fixtures/tagged';

/**
 * The Accessibility Check, driven in the real application: what it reports
 * about a tagged document, the fixes it makes, and the reading order it draws.
 */

const mainBundle = path.resolve('.vite', 'build', 'main.js');
const screenshots = process.env['PAPERFORGE_SCREENSHOTS'];

let app: ElectronApplication;
let page: Page;
let sandbox = '';
let documentPath = '';

function onPage(pageNumber: number): Locator {
  return page.locator(`[data-page-number="${String(pageNumber)}"]`);
}

function check(id: string): Locator {
  return page.locator(`[data-check="${id}"]`);
}

async function runCommand(title: string): Promise<void> {
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder('Search commands').fill(title);
  await page
    .getByRole('option', { name: new RegExp(`^${title}`) })
    .first()
    .click();
}

async function snapshot(name: string): Promise<void> {
  if (screenshots === undefined) return;
  await page.screenshot({ path: path.join(screenshots, `${name}.png`) });
}

function text(value: unknown): string | null {
  return value instanceof PDFString || value instanceof PDFHexString ? value.decodeText() : null;
}

test.beforeAll(async () => {
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'paperforge-a11y-'));
  app = await electron.launch({
    executablePath: electronBinary as unknown as string,
    args: [mainBundle, `--user-data-dir=${path.join(sandbox, 'profile')}`],
  });
  page = await app.firstWindow();
  await page.waitForSelector('[data-focus-region="workspace"]');

  const recovery = page.getByRole('dialog').filter({ hasText: 'Recover documents' });
  if ((await recovery.count()) > 0) await recovery.getByRole('button', { name: 'Discard' }).click();

  documentPath = path.join(sandbox, 'Tagged report.pdf');
  await fs.writeFile(documentPath, await buildTaggedPdf());
  await page.evaluate(
    (target: string) => window.paperforge.invoke('files:openPaths', { paths: [target] }),
    documentPath,
  );
  await page.getByRole('button', { name: 'Open Tagged report.pdf' }).click();
  await expect(onPage(1).getByText('Annual report')).toBeVisible();
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

test('the check reports what the document lacks, problems first', async () => {
  await runCommand('Accessibility Check');
  await expect(page.getByRole('heading', { name: 'Accessibility Check' })).toBeVisible();
  await expect(page.getByText(/does not certify the document/)).toBeVisible();

  await expect(check('title')).toContainText('Problem');
  await expect(check('language')).toContainText('Problem');
  await expect(check('tagged')).toContainText('Passed');
  await expect(check('figureAltText')).toContainText('1 of 2 figures has no alternate text.');
  await expect(check('readingOrder')).toContainText('Check by hand');

  // Problems are listed before what passed.
  const order = await page
    .locator('[data-check]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-check')));
  expect(order.indexOf('title')).toBeLessThan(order.indexOf('tagged'));
  await snapshot('accessibility-light');
});

test('fixes the title, the language and a figure, as undoable edits', async () => {
  await check('title').getByRole('textbox', { name: 'Title' }).fill('Annual report 2024');
  await check('title').getByRole('button', { name: 'Set title' }).click();
  await expect(check('title')).toContainText('Passed');

  await check('language').getByRole('combobox', { name: 'Language' }).fill('en GB');
  await expect(check('language')).toContainText('A language looks like');
  await check('language').getByRole('combobox', { name: 'Language' }).fill('en-GB');
  await check('language').getByRole('button', { name: 'Set language' }).click();
  await expect(check('language')).toContainText('The language is set to en-GB.');

  await check('figureAltText')
    .getByRole('button', { name: /Figure without alternate text/ })
    .click();
  // Choosing the item outlines it on its page.
  await expect(onPage(1).locator('[data-accessibility-layer]').locator('div')).toHaveCount(1);
  await check('figureAltText')
    .getByRole('textbox', { name: 'Alternate text' })
    .fill('Bar chart of sales by region');
  await check('figureAltText').getByRole('button', { name: 'Save' }).click();
  await expect(check('figureAltText')).toContainText('All 2 figures have alternate text.');

  await expect(page.getByLabel('Unsaved changes')).toBeVisible();
  await page.keyboard.press('Control+s');
  await expect(page.getByLabel('Unsaved changes')).toHaveCount(0);

  const saved = await PDFDocument.load(await fs.readFile(documentPath));
  expect(saved.getTitle()).toBe('Annual report 2024');
  expect(text(saved.catalog.lookup(PDFName.of('Lang')))).toBe('en-GB');
  const root = saved.catalog.lookup(PDFName.of('StructTreeRoot'), PDFDict);
  const documentElement = saved.context.lookup(root.get(PDFName.of('K')), PDFDict);
  const kids = documentElement.lookup(PDFName.of('K'), PDFArray);
  const alts = Array.from({ length: kids.size() }, (_, index) =>
    text(kids.lookup(index, PDFDict).lookup(PDFName.of('Alt'))),
  );
  expect(alts).toContain('Bar chart of sales by region');
});

test('draws the reading order the tags give each page', async () => {
  await page.getByRole('checkbox', { name: 'Show reading order' }).check();
  const layer = onPage(1).locator('[data-accessibility-layer]');
  await expect(layer.locator('[data-reading-order]')).toHaveCount(3);
  await expect(layer.locator('[data-reading-order="1"]')).toContainText('H1');
  await expect(layer.locator('[data-reading-order="3"]')).toContainText('Figure');
  await snapshot('accessibility-reading-order');

  await runCommand('Appearance: Dark');
  await snapshot('accessibility-dark');
  await runCommand('Appearance: Light');

  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('toolbar', { name: 'Accessibility Check' })).toHaveCount(0);
  await expect(onPage(1).locator('[data-accessibility-layer]')).toHaveCount(0);
});
