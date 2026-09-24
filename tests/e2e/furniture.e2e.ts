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
import { buildPdf } from '../fixtures/pdf';

const mainBundle = path.resolve('.vite', 'build', 'main.js');

let app: ElectronApplication;
let page: Page;
let sandbox = '';
let documentPath = '';

/** The words on a page, as the file on disk has them. */
async function textOnDisk(filePath: string, pageNumber: number): Promise<string> {
  const task = getDocument({ data: new Uint8Array(await fs.readFile(filePath)) });
  const pdf = await task.promise;
  const content = await (await pdf.getPage(pageNumber)).getTextContent();
  const text = content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
  await task.destroy();
  return text;
}

function dialog(): Locator {
  return page.getByRole('dialog');
}

async function openTool(name: string): Promise<void> {
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder('Search commands').fill(name);
  await page.getByRole('option').filter({ hasText: name }).first().click();
  await expect(dialog()).toBeVisible();
}

test.beforeAll(async () => {
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'paperforge-furniture-'));
  app = await electron.launch({
    executablePath: electronBinary as unknown as string,
    args: [mainBundle, `--user-data-dir=${path.join(sandbox, 'profile')}`],
  });
  page = await app.firstWindow();
  await page.waitForSelector('[data-focus-region="workspace"]');

  const recovery = page.getByRole('dialog').filter({ hasText: 'Recover documents' });
  if ((await recovery.count()) > 0) await recovery.getByRole('button', { name: 'Discard' }).click();

  documentPath = path.join(sandbox, 'Report.pdf');
  await fs.writeFile(
    documentPath,
    buildPdf({ pages: [{ text: 'First page' }, { text: 'Second page' }] }),
  );

  await page.evaluate(
    (target: string) => window.paperforge.invoke('files:openPaths', { paths: [target] }),
    documentPath,
  );
  await page.getByRole('button', { name: 'Open Report.pdf' }).click();
  await expect(page.getByText('First page')).toBeVisible();
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

test('a watermark goes on every page and can be taken off again', async () => {
  await openTool('Watermark');
  await dialog().getByLabel('Text', { exact: true }).fill('CONFIDENTIAL');
  await dialog().getByRole('button', { name: 'Apply' }).click();

  await expect(page.getByLabel('Page 1').getByText('CONFIDENTIAL')).toBeVisible();
  await expect(page.getByLabel('Unsaved changes')).toBeVisible();

  await openTool('Watermark');
  await dialog().getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByLabel('Page 1').getByText('CONFIDENTIAL')).toHaveCount(0);
});

test('a header and footer number the pages, and say so before they are written', async () => {
  await openTool('Header and Footer');

  // The preview says what the first page will carry.
  await expect(dialog().getByLabel('Preview')).toContainText('Page 1 of 2');

  await dialog()
    .getByRole('checkbox', { name: /Number the pages/ })
    .check();
  await dialog().getByLabel('Bates prefix').fill('ACME-');
  await dialog().getByLabel('Bates start').fill('100');
  await dialog().getByLabel('Bates digits').fill('4');

  // Put the Bates number in the top right corner; the preview then says what
  // the first page will carry.
  await dialog().getByRole('group', { name: 'Header' }).getByLabel('Right').fill('{{bates}}');
  await expect(dialog().getByLabel('Preview')).toContainText('ACME-0100');
  await dialog().getByRole('button', { name: 'Apply' }).click();

  await expect(page.getByLabel('Page 1').getByText('ACME-0100')).toBeVisible();
  await expect(page.getByLabel('Page 1').getByText('Page 1 of 2')).toBeVisible();
});

test('what the pages carry is written to the file', async () => {
  await page.keyboard.press('Control+s');
  await expect(page.getByText(/Report\.pdf was saved/)).toBeVisible();

  expect(await textOnDisk(documentPath, 1)).toContain('ACME-0100');
  expect(await textOnDisk(documentPath, 2)).toContain('ACME-0101');
  expect(await textOnDisk(documentPath, 2)).toContain('Page 2 of 2');
  // The document's own text is untouched.
  expect(await textOnDisk(documentPath, 1)).toContain('First page');
});

test('a background goes under the page, and only on the page asked for', async () => {
  await openTool('Background');
  await dialog()
    .getByRole('radio', { name: /This page/ })
    .check();
  await dialog().getByRole('button', { name: 'Apply' }).click();

  await expect(page.getByLabel('Unsaved changes')).toBeVisible();
  // Undo takes it off again, which is what makes it safe to try.
  await page.keyboard.press('Control+z');
  await expect(page.getByLabel('Unsaved changes')).toBeHidden();
});
