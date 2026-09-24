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
import { buildScannedPdf } from '../fixtures/scans';

const mainBundle = path.resolve('.vite', 'build', 'main.js');

let app: ElectronApplication;
let page: Page;
let sandbox = '';
let documentPath = '';

/** The words the test draws onto the picture, and then expects to get back. */
const LINES = ['Invoice ACME-0042', 'Widgets and sundries', 'Total 1250.50'];

/** The text of a page in the file on disk, as PDF.js extracts it. */
async function textOnDisk(filePath: string): Promise<string> {
  const task = getDocument({ data: new Uint8Array(await fs.readFile(filePath)) });
  const pdf = await task.promise;
  const content = await (await pdf.getPage(1)).getTextContent();
  const text = content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
  await task.destroy();
  return text;
}

function dialog(): Locator {
  return page.getByRole('dialog');
}

async function openOcr(): Promise<void> {
  await page.getByRole('menuitem', { name: 'Tools' }).click();
  await page.getByRole('menuitem', { name: /Recognize Text/ }).click();
  await expect(dialog()).toBeVisible();
}

test.beforeAll(async () => {
  test.setTimeout(180_000);
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'paperforge-ocr-'));
  app = await electron.launch({
    executablePath: electronBinary as unknown as string,
    args: [mainBundle, `--user-data-dir=${path.join(sandbox, 'profile')}`],
  });
  page = await app.firstWindow();
  await page.waitForSelector('[data-focus-region="workspace"]');

  const recovery = page.getByRole('dialog').filter({ hasText: 'Recover documents' });
  if ((await recovery.count()) > 0) await recovery.getByRole('button', { name: 'Discard' }).click();

  // A picture of words, drawn in the window because only a canvas can write
  // text, and then wrapped in a PDF that has nothing else on the page.
  const drawn = await page.evaluate((lines: string[]) => {
    const canvas = window.document.createElement('canvas');
    canvas.width = 1700;
    canvas.height = 2200;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('no canvas');

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#000000';
    context.font = '64px "Times New Roman", Georgia, serif';
    lines.forEach((line, index) => {
      context.fillText(line, 160, 260 + index * 140);
    });

    return canvas.toDataURL('image/png').split(',')[1] ?? '';
  }, LINES);

  documentPath = path.join(sandbox, 'Scan.pdf');
  await fs.writeFile(
    documentPath,
    await buildScannedPdf({ image: new Uint8Array(Buffer.from(drawn, 'base64')) }),
  );

  await page.evaluate(
    (target: string) => window.paperforge.invoke('files:openPaths', { paths: [target] }),
    documentPath,
  );
  await page.getByRole('button', { name: 'Open Scan.pdf' }).click();
  await expect(page.getByLabel('Page 1')).toBeVisible();
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

test('a scan has no text to find before it is read', async () => {
  expect((await textOnDisk(documentPath)).trim()).toBe('');
});

test('the dialog says where Tesseract is and what it can read', async () => {
  await openOcr();

  // This machine has Tesseract; a machine without it would say so instead.
  await expect(dialog()).toContainText(/tesseract/i);
  await expect(dialog().getByLabel('Language')).toBeVisible();
});

test('reading the page finds the words that were drawn on it', async () => {
  test.setTimeout(120_000);
  await dialog().getByRole('button', { name: 'Recognize', exact: true }).click();

  await expect(dialog()).toContainText(/words on 1 page/, { timeout: 90_000 });
  await expect(page.getByLabel('Unsaved changes')).toBeVisible();
});

test('the words are in the document, and can be searched', async () => {
  // The dialog has a close button of its own beside the one in the footer.
  await dialog().getByRole('button', { name: 'Close', exact: true }).last().click();

  await page.keyboard.press('Control+f');
  await page.getByRole('searchbox', { name: 'Find in document' }).fill('ACME');
  await expect(page.getByText(/matches|1 of/i).first()).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press('Escape');
});

test('what was read is in the saved file, and the page still looks like a scan', async () => {
  await page.keyboard.press('Control+s');
  await expect(page.getByText(/Scan\.pdf was saved/)).toBeVisible();

  const text = await textOnDisk(documentPath);
  expect(text).toContain('ACME-0042');
  expect(text).toContain('Widgets');

  // The picture is still the only thing drawn: the words are invisible.
  const task = getDocument({ data: new Uint8Array(await fs.readFile(documentPath)) });
  const pdf = await task.promise;
  const operators = await (await pdf.getPage(1)).getOperatorList();
  await task.destroy();
  expect(operators.fnArray.length).toBeGreaterThan(0);
});

test('reading it again replaces the words rather than stacking a second set', async () => {
  await openOcr();
  await dialog()
    .getByRole('button', { name: /Recognize/ })
    .click();
  await expect(dialog()).toContainText(/words on 1 page/, { timeout: 90_000 });
  await dialog().getByRole('button', { name: 'Close', exact: true }).last().click();

  await page.keyboard.press('Control+s');
  await expect(page.getByText(/Scan\.pdf was saved/)).toBeVisible();

  const text = await textOnDisk(documentPath);
  const occurrences = text.split('ACME-0042').length - 1;
  expect(occurrences).toBe(1);
});
