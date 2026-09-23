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

/** Every text box the editor draws, across the pages on screen. */
function runs(): Locator {
  return page.locator('[data-run]');
}

/** The text boxes of one page, since the viewer mounts its neighbours too. */
function runsOn(pageNumber: number): Locator {
  return page.getByLabel(`Page ${String(pageNumber)}`).locator('[data-run]');
}

/** Text as the page shows it, rather than as a panel repeats it. */
function shownOnPage(pageNumber: number, text: string): Locator {
  return page.getByLabel(`Page ${String(pageNumber)}`).getByText(text);
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
        // A composite font with no ToUnicode says nothing about its codes, so
        // its text can only be replaced, not rewritten.
        { content: 'BT /F2 18 Tf 1 0 0 1 60 700 Tm <00410042> Tj ET\n' },
      ],
      fonts: [{ name: 'F2', composite: true, cidWidths: { 0x41: 600, 0x42: 600 } }],
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

  await expect(runsOn(1)).toHaveCount(2);
  await expect(runsOn(1).first()).toHaveAttribute('title', 'The first line');
});

test('selecting a run says what drew it', async () => {
  await runsOn(1).first().click();

  const properties = page.getByRole('region', { name: 'Properties and tools' });
  await expect(properties).toContainText('Helvetica');
  await expect(properties).toContainText('18 pt');
  await expect(properties).toContainText('The first line');
});

test('clicking again opens the text for typing', async () => {
  await runsOn(1).first().click();
  await expect(field()).toBeVisible();
  await expect(field()).toHaveValue('The first line');
});

test('escape leaves the text as it was', async () => {
  await page.keyboard.press('Control+a');
  await page.keyboard.type('thrown away');
  await page.keyboard.press('Escape');

  await expect(field()).toHaveCount(0);
  await expect(page.getByLabel('Unsaved changes')).toBeHidden();
  await expect(runsOn(1).first()).toHaveAttribute('title', 'The first line');
});

test('what is typed is written into the document', async () => {
  await runsOn(1).first().click();
  await runsOn(1).first().click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('A changed line');
  await page.keyboard.press('Enter');

  // The page is drawn again from the change, in the font that was there.
  await expect(shownOnPage(1, 'A changed line')).toBeVisible();
  await expect(page.getByLabel('Unsaved changes')).toBeVisible();
  // The other line is exactly as it was.
  await expect(shownOnPage(1, 'The second line')).toBeVisible();
});

test('undo puts the old text back', async () => {
  await page.keyboard.press('Control+z');
  await expect(shownOnPage(1, 'The first line')).toBeVisible();
  await expect(page.getByLabel('Unsaved changes')).toBeHidden();

  await page.keyboard.press('Control+y');
  await expect(shownOnPage(1, 'A changed line')).toBeVisible();
});

test('saving writes what the page now says', async () => {
  await page.keyboard.press('Control+s');
  await expect(page.getByText(/Words\.pdf was saved/)).toBeVisible();

  expect(await textOnDisk(documentPath)).toBe('A changed lineThe second line');
});

test('the change is still there when the document is reopened', async () => {
  await page.keyboard.press('Control+w');
  await page.getByRole('button', { name: 'Open Words.pdf' }).click();
  await expect(shownOnPage(1, 'A changed line')).toBeVisible();
});

test('text the font cannot write offers a replacement instead', async () => {
  await openEditor();
  await runsOn(1).first().click();
  await runsOn(1).first().click();
  await page.keyboard.press('Control+a');
  // WinAnsi has no Cyrillic, and the page is drawn in a WinAnsi font.
  await page.keyboard.type('Привет');
  await page.keyboard.press('Enter');

  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('cannot write “П”');
  await dialog.getByRole('button', { name: 'Replace the text' }).click();

  // The standard fonts cannot draw it either, so nothing is written and the
  // reader is told why rather than being given question marks.
  await expect(page.getByRole('alert')).toContainText('cannot write “П” into a PDF yet');
  await expect(shownOnPage(1, 'A changed line')).toBeVisible();
  await expect(page.getByLabel('Unsaved changes')).toBeHidden();
});

test('text that can only be replaced says so, and is replaced', async () => {
  // Page two is drawn with a font that does not say what its codes mean.
  await page.getByRole('textbox', { name: 'Page number' }).fill('2');
  await page.getByRole('textbox', { name: 'Page number' }).press('Enter');
  const locked = runsOn(2).and(page.locator('[data-editable="replace"]')).first();
  await expect(locked).toBeVisible();
  await locked.click();
  const properties = page.getByRole('region', { name: 'Properties and tools' });
  await expect(properties).toContainText('does not say what its characters are');

  await locked.click();
  await expect(field()).toBeVisible();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Drawn by PaperForge');
  await page.keyboard.press('Enter');

  await expect(shownOnPage(2, 'Drawn by PaperForge')).toBeVisible();
  await expect(page.getByLabel('Unsaved changes')).toBeVisible();

  // PaperForge says which text it drew itself.
  await page.locator('[data-run][title="Drawn by PaperForge"]').click();
  await expect(properties).toContainText('PaperForge drew this text');
});

test('new text is added where the reader points', async () => {
  await page.getByRole('button', { name: 'Add text' }).click();
  await expect(page.locator('[data-text-layer="placing"]').first()).toBeVisible();

  const pageView = page.locator('[data-page-number="2"]');
  const box = await pageView.boundingBox();
  if (box === null) throw new Error('the page is not on screen');
  await page.mouse.click(box.x + 120, box.y + 320);

  await expect(page.locator('[data-new-text]')).toBeVisible();
  await page.keyboard.type('A new line of text');
  await page.keyboard.press('Enter');

  await expect(shownOnPage(2, 'A new line of text')).toBeVisible();
});

test('leaving the editor goes back to reading', async () => {
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(runs()).toHaveCount(0);
  await expect(shownOnPage(2, 'A new line of text')).toBeVisible();
});
