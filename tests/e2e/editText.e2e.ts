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
async function textOnDisk(filePath: string, pageNumber = 1): Promise<string> {
  const task = getDocument({ data: new Uint8Array(await fs.readFile(filePath)) });
  const pdf = await task.promise;
  const content = await (await pdf.getPage(pageNumber)).getTextContent();
  const text = content.items
    .map((item) => ('str' in item ? item.str : ''))
    .join('')
    .trim();
  await task.destroy();
  return text;
}

/** The boxes the editor draws around the text of the page on screen. */
function runs(): Locator {
  return page.locator('[data-run]');
}

function field(): Locator {
  return page.locator('[data-run] input');
}

async function openEditor(): Promise<void> {
  const toolbar = page.getByRole('toolbar', { name: 'Text editing' });
  if ((await toolbar.count()) === 0) await page.keyboard.press('Control+e');
  await expect(toolbar).toBeVisible();
}

test.beforeAll(async () => {
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'paperforge-edit-'));
  app = await electron.launch({
    executablePath: electronBinary as unknown as string,
    args: [mainBundle, `--user-data-dir=${path.join(sandbox, 'profile')}`],
  });
  page = await app.firstWindow();
  await page.waitForSelector('[data-focus-region="workspace"]');

  const recovery = page.getByRole('dialog').filter({ hasText: 'Recover documents' });
  if ((await recovery.count()) > 0) await recovery.getByRole('button', { name: 'Discard' }).click();

  documentPath = path.join(sandbox, 'Words.pdf');
  await fs.writeFile(
    documentPath,
    buildPdf({
      pages: [
        {
          content:
            'BT /F1 18 Tf 1 0 0 1 60 700 Tm (The first line) Tj 0 -24 Td (The second line) Tj ET\n',
        },
      ],
    }),
  );

  await page.evaluate(
    (target: string) => window.paperforge.invoke('files:openPaths', { paths: [target] }),
    documentPath,
  );
  await page.getByRole('button', { name: 'Open Words.pdf' }).click();
  await expect(page.getByText('The first line')).toBeVisible();
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

test('the editor puts a box around every piece of text the page draws', async () => {
  await openEditor();

  await expect(runs()).toHaveCount(2);
  await expect(runs().first()).toHaveAttribute('title', 'The first line');
});

test('selecting a run says what drew it', async () => {
  await runs().first().click();

  const properties = page.getByRole('region', { name: 'Properties and tools' });
  await expect(properties).toContainText('Helvetica');
  await expect(properties).toContainText('18 pt');
  await expect(properties).toContainText('The first line');
});

test('clicking again opens the text for typing', async () => {
  await runs().first().click();
  await expect(field()).toBeVisible();
  await expect(field()).toHaveValue('The first line');
});

test('escape leaves the text as it was', async () => {
  await page.keyboard.press('Control+a');
  await page.keyboard.type('thrown away');
  await page.keyboard.press('Escape');

  await expect(field()).toHaveCount(0);
  await expect(page.getByLabel('Unsaved changes')).toBeHidden();
  await expect(runs().first()).toHaveAttribute('title', 'The first line');
});

test('what is typed is written into the document', async () => {
  await runs().first().click();
  await runs().first().click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('A changed line');
  await page.keyboard.press('Enter');

  // The page is drawn again from the change, in the font that was there.
  await expect(page.getByText('A changed line')).toBeVisible();
  await expect(page.getByLabel('Unsaved changes')).toBeVisible();
  // The other line is exactly as it was.
  await expect(page.getByText('The second line')).toBeVisible();
});

test('undo puts the old text back', async () => {
  await page.keyboard.press('Control+z');
  await expect(page.getByText('The first line')).toBeVisible();
  await expect(page.getByLabel('Unsaved changes')).toBeHidden();

  await page.keyboard.press('Control+y');
  await expect(page.getByText('A changed line')).toBeVisible();
});

test('saving writes what the page now says', async () => {
  await page.keyboard.press('Control+s');
  await expect(page.getByText(/Words\.pdf was saved/)).toBeVisible();

  expect(await textOnDisk(documentPath)).toBe('A changed lineThe second line');
});

test('the change is still there when the document is reopened', async () => {
  await page.keyboard.press('Control+w');
  await page.getByRole('button', { name: 'Open Words.pdf' }).click();
  await expect(page.getByText('A changed line')).toBeVisible();
});

test('text a font cannot write is refused, not written badly', async () => {
  await openEditor();
  await runs().first().click();
  await runs().first().click();
  await page.keyboard.press('Control+a');
  // WinAnsi has no Cyrillic, and the page is drawn in a WinAnsi font.
  await page.keyboard.type('Привет');
  await page.keyboard.press('Enter');

  await expect(page.getByRole('alert')).toContainText('cannot write');
  await expect(page.getByText('A changed line')).toBeVisible();
});

test('leaving the editor goes back to reading', async () => {
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(runs()).toHaveCount(0);
  await expect(page.getByText('A changed line')).toBeVisible();
});
