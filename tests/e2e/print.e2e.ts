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
import { PDFDocument } from 'pdf-lib';
import { buildPdf } from '../fixtures/pdf';

const mainBundle = path.resolve('.vite', 'build', 'main.js');

let app: ElectronApplication;
let page: Page;
let sandbox = '';

interface CapturedPrint {
  options: Electron.WebContentsPrintOptions;
  pdf: string;
}

function dialog(): Locator {
  return page.getByRole('dialog', { name: 'Print' });
}

/**
 * Stands in for the printer. Chromium's own printing is replaced, for every
 * window, by printing the same document to a PDF that the test can read; the
 * options PaperForge passed are kept with it.
 */
async function replacePrinter(): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    const [window] = BrowserWindow.getAllWindows();
    if (window === undefined) throw new Error('No window.');
    const store = globalThis as unknown as { printed: CapturedPrint[] };
    store.printed = [];
    const prototype = Object.getPrototypeOf(window.webContents) as Electron.WebContents;
    prototype.print = function print(
      this: Electron.WebContents,
      options: Electron.WebContentsPrintOptions = {},
      callback?: (success: boolean, failureReason: string) => void,
    ): void {
      this.printToPDF({
        landscape: options.landscape ?? false,
        pageSize: 'Letter',
        printBackground: true,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      }).then(
        (data) => {
          store.printed.push({ options, pdf: data.toString('base64') });
          callback?.(true, '');
        },
        (error: unknown) => callback?.(false, String(error)),
      );
    };
  });
}

async function takePrinted(): Promise<CapturedPrint[]> {
  return app.evaluate(() => {
    const store = globalThis as unknown as { printed: CapturedPrint[] };
    const printed = store.printed;
    store.printed = [];
    return printed;
  });
}

async function openPrint(): Promise<void> {
  await page.getByLabel('Page 1').click();
  await page.keyboard.press('Control+P');
  await expect(dialog()).toBeVisible();
}

test.beforeAll(async () => {
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'paperforge-print-'));
  app = await electron.launch({
    executablePath: electronBinary as unknown as string,
    args: [mainBundle, `--user-data-dir=${path.join(sandbox, 'profile')}`],
  });
  page = await app.firstWindow();
  await page.waitForSelector('[data-focus-region="workspace"]');

  const recovery = page.getByRole('dialog').filter({ hasText: 'Recover documents' });
  if ((await recovery.count()) > 0) await recovery.getByRole('button', { name: 'Discard' }).click();

  // Two upright pages and one on its side.
  const documentPath = path.join(sandbox, 'Handout ü.pdf');
  await fs.writeFile(
    documentPath,
    buildPdf({
      pages: [
        { text: 'First page' },
        { text: 'Second page', width: 792, height: 612 },
        { text: 'Third page' },
      ],
    }),
  );
  await page.evaluate(
    (target: string) => window.paperforge.invoke('files:openPaths', { paths: [target] }),
    documentPath,
  );
  await page.getByRole('button', { name: 'Open Handout ü.pdf' }).click();
  await expect(page.getByLabel('Page 1')).toBeVisible();
  await replacePrinter();
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

test('Ctrl+P lists the printers Windows has', async () => {
  await openPrint();
  const printer = dialog().getByLabel('Printer');
  await expect(printer.locator('option').first()).toHaveText('The Windows default printer');
  await expect(dialog().getByText('All 3 pages')).toBeVisible();
  await dialog().getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog()).toBeHidden();
});

test('prints every page, one sheet each, the paper following the pages', async () => {
  await openPrint();
  await dialog().getByLabel('Copies', { exact: true }).fill('2');
  await dialog().getByRole('button', { name: 'Print', exact: true }).click();
  await expect(dialog()).toBeHidden({ timeout: 30_000 });
  await expect(page.getByText('Sent 3 pages to the printer')).toBeVisible();

  const [job] = await takePrinted();
  expect(job).toBeDefined();
  expect(job?.options).toMatchObject({ silent: true, copies: 2, landscape: false, color: true });

  const printed = await PDFDocument.load(Buffer.from(job?.pdf ?? '', 'base64'));
  expect(printed.getPageCount()).toBe(3);
  // Each sheet carries the page as a picture.
  const raw = Buffer.from(job?.pdf ?? '', 'base64').toString('latin1');
  expect(raw.match(/\/Subtype\s*\/Image/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
});

test('prints the even pages of a range, in grey, on its side', async () => {
  await openPrint();
  await dialog().getByLabel('Pages to print').fill('1-3');
  await dialog().getByLabel('Print', { exact: true }).selectOption('even');
  await dialog().getByLabel('Orientation').selectOption('landscape');
  await dialog().getByText('Print in shades of grey').click();
  await expect(dialog().getByText(/^1 page, 2 copies/)).toBeVisible();
  await dialog().getByRole('button', { name: 'Print', exact: true }).click();
  await expect(dialog()).toBeHidden({ timeout: 30_000 });

  const [job] = await takePrinted();
  expect(job?.options).toMatchObject({ landscape: true, color: false, copies: 2 });
  const printed = await PDFDocument.load(Buffer.from(job?.pdf ?? '', 'base64'));
  expect(printed.getPageCount()).toBe(1);
  const { width, height } = printed.getPage(0).getSize();
  expect(width).toBeGreaterThan(height);
});

test('explains a range with nothing to print', async () => {
  await openPrint();
  await dialog().getByLabel('Pages to print').fill('2');
  await dialog().getByLabel('Print', { exact: true }).selectOption('odd');
  await expect(dialog().getByText('Those pages include no odd pages.')).toBeVisible();
  await expect(dialog().getByRole('button', { name: 'Print', exact: true })).toBeDisabled();
  await dialog().getByRole('button', { name: 'Cancel' }).click();
});
