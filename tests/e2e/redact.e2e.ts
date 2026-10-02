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

/**
 * Redaction in the real application: mark by search and by area, review,
 * apply, undo, save — and then read the file on disk the way anyone else
 * would, to show the marked text is not in it.
 */

const mainBundle = path.resolve('.vite', 'build', 'main.js');

let app: ElectronApplication;
let page: Page;
let sandbox = '';
let documentPath = '';

function dialog(): Locator {
  return page.getByRole('dialog');
}

function onPage(pageNumber: number): Locator {
  return page.locator(`[data-page-number="${String(pageNumber)}"]`);
}

/** Every word PDF.js reads out of a file on disk, page by page. */
async function textOnDisk(filePath: string): Promise<string[]> {
  const task = getDocument({ data: new Uint8Array(await fs.readFile(filePath)) });
  const pdf = await task.promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const content = await (await pdf.getPage(pageNumber)).getTextContent();
    pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
  }
  await task.destroy();
  return pages;
}

/** Drags over a piece of text on the page, from one share of its width to another. */
async function dragOver(target: Locator, from = 0, to = 1): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (box === null) throw new Error('nothing to drag over');
  await page.mouse.move(box.x + box.width * from - 3, box.y - 4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * to + 3, box.y + box.height + 4, { steps: 8 });
  await page.mouse.up();
}

async function openRedaction(): Promise<void> {
  if (await page.getByRole('toolbar', { name: 'Redaction tools' }).isVisible()) return;
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder('Search commands').fill('Redact');
  await page
    .getByRole('option', { name: /^Redact/ })
    .first()
    .click();
  await expect(page.getByRole('toolbar', { name: 'Redaction tools' })).toBeVisible();
}

test.beforeAll(async () => {
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'paperforge-redact-'));
  app = await electron.launch({
    executablePath: electronBinary as unknown as string,
    args: [mainBundle, `--user-data-dir=${path.join(sandbox, 'profile')}`],
  });
  page = await app.firstWindow();
  await page.waitForSelector('[data-focus-region="workspace"]');

  const recovery = page.getByRole('dialog').filter({ hasText: 'Recover documents' });
  if ((await recovery.count()) > 0) await recovery.getByRole('button', { name: 'Discard' }).click();

  documentPath = path.join(sandbox, 'Statement.pdf');
  await fs.writeFile(
    documentPath,
    buildPdf({
      pages: [
        {
          content:
            'BT /F1 18 Tf 72 700 Td (Account holder: TOP SECRET PHRASE) Tj ET\n' +
            'BT /F1 18 Tf 72 600 Td (Card number 4111 2222 3333) Tj ET\n' +
            'BT /F1 18 Tf 72 500 Td (Nothing to hide here) Tj ET\n',
        },
        {
          content: 'q 1 0 0 1 72 600 cm /Fm0 Do Q\n',
          form: {
            content: 'BT /F1 18 Tf 0 10 Td (Grouped confidential words) Tj ET\n',
            bbox: [0, 0, 400, 40],
          },
        },
      ],
    }),
  );

  await page.evaluate(
    (target: string) => window.paperforge.invoke('files:openPaths', { paths: [target] }),
    documentPath,
  );
  await page.getByRole('button', { name: 'Open Statement.pdf' }).click();
  await expect(page.getByText('Account holder: TOP SECRET PHRASE')).toBeVisible();
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

test('marks are pending and change nothing until applied', async () => {
  await openRedaction();
  await expect(page.getByText('Nothing is marked yet.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Apply Redactions…' }).first()).toBeDisabled();

  await page.getByRole('searchbox', { name: 'Find text to mark' }).fill('secret phrase');
  await page.getByRole('button', { name: 'Mark all' }).click();
  await expect(page.getByText(/Marked 1 occurrence/)).toBeVisible();

  const marks = page.getByRole('list', { name: 'Marked for redaction' });
  await expect(marks.getByText('SECRET PHRASE')).toBeVisible();
  await expect(onPage(1).locator('[data-redaction-mark]')).toHaveCount(1);

  // An area, dragged over the card number.
  await page.getByRole('button', { name: 'Mark area' }).click();
  await dragOver(onPage(1).getByText('Card number 4111 2222 3333'), 0.47, 1);
  await expect(page.getByText('2 marked')).toBeVisible();

  // Pending marks are not edits.
  await expect(page.getByLabel('Unsaved changes')).toHaveCount(0);
});

test('the review says what each mark takes, and applying removes it', async () => {
  await page.getByRole('button', { name: 'Apply Redactions…' }).first().click();
  await expect(dialog()).toContainText('“SECRET PHRASE”');
  await expect(dialog()).toContainText('4111 2222 3333');
  await expect(dialog()).not.toContainText('Drawn as pictures');

  await dialog()
    .getByRole('radio', { name: /Change this document only/ })
    .check();
  await dialog().getByRole('button', { name: 'Apply Redactions' }).click();

  await expect(page.getByText(/Redactions applied on 1 page/)).toBeVisible();
  await expect(page.getByLabel('Unsaved changes')).toBeVisible();
  await expect(onPage(1).getByText('Account holder:')).toBeVisible();
  await expect(onPage(1).getByText(/SECRET/)).toHaveCount(0);
  await expect(onPage(1).getByText(/4111/)).toHaveCount(0);
  await expect(onPage(1).getByText('Nothing to hide here')).toBeVisible();
});

test('undo brings it back until the document is saved', async () => {
  await page.keyboard.press('Control+z');
  await expect(onPage(1).getByText('Account holder: TOP SECRET PHRASE')).toBeVisible();
  await page.keyboard.press('Control+y');
  await expect(onPage(1).getByText(/SECRET/)).toHaveCount(0);

  await page.keyboard.press('Control+s');
  await expect(page.getByText(/Statement\.pdf was saved/)).toBeVisible();

  const [first] = await textOnDisk(documentPath);
  expect(first).toContain('Account holder');
  expect(first).toContain('Nothing to hide here');
  expect(first).not.toContain('SECRET');
  expect(first).not.toContain('4111');
});

test('a page that cannot be cut is drawn as a picture and saved as a new file', async () => {
  await openRedaction();
  await page.getByRole('button', { name: 'Mark area' }).click();
  // Half of a group: PaperForge cannot cut into it, so the page must be drawn.
  await dragOver(onPage(2).getByText('Grouped confidential words'), 0, 0.4);
  await expect(page.getByText('1 marked')).toBeVisible();

  await page.getByRole('button', { name: 'Apply Redactions…' }).first().click();
  await expect(dialog()).toContainText('Drawn as pictures');
  await expect(dialog()).toContainText('reusable group');

  const target = path.join(sandbox, 'Statement redacted.pdf');
  await app.evaluate(({ dialog: electronDialog }, chosen: string) => {
    electronDialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: chosen });
  }, target);
  await expect(dialog().getByRole('radio', { name: /Save the redacted document/ })).toBeChecked();
  await dialog().getByRole('button', { name: 'Apply Redactions' }).click();

  await expect(page.getByText(/Statement redacted\.pdf was saved/)).toBeVisible({
    timeout: 20_000,
  });
  const pages = await textOnDisk(target);
  expect(pages[1]).not.toMatch(/Grouped|confidential/);
  expect(pages[0]).toContain('Account holder');

  // The file that was opened is the one saved before, untouched by this.
  const original = await textOnDisk(documentPath);
  expect(original[1]).toContain('Grouped confidential words');
});

test('selecting text with the text tool marks what was selected', async () => {
  await openRedaction();
  await page.getByRole('button', { name: 'Mark text' }).click();
  const words = onPage(1).getByText('Nothing to hide here');
  await words.scrollIntoViewIfNeeded();
  const box = await words.boundingBox();
  if (box === null) throw new Error('the words were not found');
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();

  const marks = page.getByRole('list', { name: 'Marked for redaction' });
  await expect(marks.getByText('Nothing to hide here')).toBeVisible();
  await page.getByRole('button', { name: 'Clear all' }).click();
  await expect(page.getByText('Nothing is marked yet.')).toBeVisible();
});
