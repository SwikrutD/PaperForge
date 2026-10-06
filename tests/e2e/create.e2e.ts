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
import { buildPdf, threePageDocument } from '../fixtures/pdf';
import { pngPixel } from '../fixtures/images';

const mainBundle = path.resolve('.vite', 'build', 'main.js');

let app: ElectronApplication;
let page: Page;
let sandbox = '';
/** Where a save dialog will be told to write, for each test that saves. */
let output = '';

const files: Record<string, string> = {};

async function pagesOnDisk(filePath: string): Promise<string[]> {
  const task = getDocument({ data: new Uint8Array(await fs.readFile(filePath)) });
  const pdf = await task.promise;
  const texts: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const content = await (await pdf.getPage(pageNumber)).getTextContent();
    texts.push(
      content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join('')
        .trim(),
    );
  }
  await task.destroy();
  return texts;
}

/** The top-level bookmark titles of a written document. */
async function bookmarksOnDisk(filePath: string): Promise<string[]> {
  const task = getDocument({ data: new Uint8Array(await fs.readFile(filePath)) });
  const pdf = await task.promise;
  const outline = (await pdf.getOutline()) as Array<{ title: string }> | null;
  await task.destroy();
  return (outline ?? []).map((item) => item.title);
}

function sourceRows(): Locator {
  return page.getByRole('list', { name: 'Files to combine' }).locator('li');
}

function documentTabs(): Locator {
  return page.getByRole('tablist', { name: 'Open documents' }).getByRole('tab');
}

/** Points the next file picker at these files. */
async function chooseFiles(paths: readonly string[]): Promise<void> {
  await app.evaluate(
    ({ dialog }, targets: string[]) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: targets });
    },
    [...paths],
  );
}

/** Points the next save dialog at this file. */
async function saveTo(target: string): Promise<void> {
  output = target;
  await app.evaluate(({ dialog }, value: string) => {
    dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: value });
  }, target);
}

/**
 * Opens a tool from the Tools menu, which works with a document open or not.
 * A menu item's name includes its shortcut, so the match is on the start.
 */
async function runTool(name: string): Promise<void> {
  await page.getByRole('menuitem', { name: 'Tools' }).click();
  await page.getByRole('menuitemcheckbox', { name: new RegExp(`^${name}`) }).click();
}

async function addFiles(paths: readonly string[]): Promise<void> {
  await chooseFiles(paths);
  await page.getByRole('button', { name: 'Add files…' }).first().click();
}

test.beforeAll(async () => {
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'paperforge-create-'));
  app = await electron.launch({
    executablePath: electronBinary as unknown as string,
    args: [mainBundle, `--user-data-dir=${path.join(sandbox, 'profile')}`],
  });
  page = await app.firstWindow();
  await page.waitForSelector('[data-focus-region="workspace"]');

  const recovery = page.getByRole('dialog').filter({ hasText: 'Recover documents' });
  if ((await recovery.count()) > 0) await recovery.getByRole('button', { name: 'Discard' }).click();

  files['first'] = path.join(sandbox, 'First.pdf');
  files['second'] = path.join(sandbox, 'Second.pdf');
  files['image'] = path.join(sandbox, 'Picture.png');
  files['text'] = path.join(sandbox, 'Notes.txt');
  files['other'] = path.join(sandbox, 'Archive.zip');
  files['office'] = path.join(sandbox, 'Letter.docx');

  await fs.writeFile(
    files['first'],
    buildPdf({
      pages: [{ text: 'First one' }, { text: 'First two' }, { text: 'First three' }],
      outline: [{ title: 'Chapter one', page: 1 }],
    }),
  );
  await fs.writeFile(files['second'], threePageDocument());
  await fs.writeFile(files['image'], pngPixel(60, 40));
  await fs.writeFile(files['text'], 'Notes made outside PaperForge.\nSecond line.');
  await fs.writeFile(files['other'], 'PK not really an archive');
  await fs.writeFile(files['office'], 'PK not really a Word document');
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

test('the combine workspace opens from the home screen', async () => {
  await page
    .getByRole('button', { name: /Combine Files/ })
    .first()
    .click();

  await expect(page.getByRole('heading', { name: 'Combine Files' })).toBeVisible();
  await expect(page.getByText('Add the files to make a document from')).toBeVisible();
  await expect(page.getByText('No files yet')).toBeVisible();
});

test('files of several kinds become pages, listed with what they became', async () => {
  await addFiles([files['first'] as string, files['image'] as string, files['text'] as string]);

  await expect(sourceRows()).toHaveCount(3);
  await expect(sourceRows().nth(0)).toContainText('First.pdf');
  await expect(sourceRows().nth(0)).toContainText('3 pages');
  await expect(sourceRows().nth(1)).toContainText('Picture.png');
  await expect(sourceRows().nth(1)).toContainText('1 page');
  await expect(sourceRows().nth(2)).toContainText('Notes.txt');

  // Three files, five pages between them.
  await expect(page.getByText('3 files · 5 pages')).toBeVisible();
});

test('an Office file says what PaperForge would need to convert it', async () => {
  await addFiles([files['office'] as string]);

  // LibreOffice is not installed on this machine, so the file is refused with
  // a reason rather than silently producing nothing — and the reason says
  // plainly that nothing would be uploaded either way.
  const alert = page.getByRole('alert');
  await expect(alert).toContainText(/LibreOffice/);
  await expect(alert).toContainText(/nothing is uploaded/i);
});

test('a file it cannot make pages from is reported, not silently dropped', async () => {
  await addFiles([files['other'] as string]);

  await expect(page.getByRole('alert')).toContainText('Archive.zip');
  await expect(page.getByRole('alert')).toContainText('.zip');
  await expect(sourceRows()).toHaveCount(3);
});

test('the reader chooses the order and the pages each file contributes', async () => {
  // Only the last two pages of the PDF, and the picture first.
  await sourceRows().nth(0).getByRole('textbox', { name: 'Pages' }).fill('2-3');
  await sourceRows()
    .nth(1)
    .getByRole('button', { name: /Move Picture\.png up/ })
    .click();

  await expect(sourceRows().nth(0)).toContainText('Picture.png');
  await expect(sourceRows().nth(1)).toContainText('taking 2');
  await expect(page.getByText('3 files · 4 pages')).toBeVisible();
});

test('combining writes the document, opens it, and leaves the sources alone', async () => {
  const target = path.join(sandbox, 'Combined.pdf');
  await saveTo(target);
  await page.getByRole('button', { name: 'Combine…' }).click();

  await expect(page.getByText(/A document of 4 pages was made/)).toBeVisible();
  // The workspace gives way to the document it just made.
  await expect(documentTabs().filter({ hasText: 'Combined.pdf' })).toHaveCount(1);
  await expect(page.getByText('of 4', { exact: true })).toBeVisible();

  // The picture first, then two pages of the PDF, then the notes.
  expect(await pagesOnDisk(target)).toEqual([
    '',
    'First two',
    'First three',
    'Notes made outside PaperForge.Second line.',
  ]);
  // Each file that contributed pages is named in the outline.
  expect(await bookmarksOnDisk(target)).toEqual(['Picture', 'First', 'Notes']);

  // Nothing was written to the files the pages came from.
  expect(await pagesOnDisk(files['first'] as string)).toEqual([
    'First one',
    'First two',
    'First three',
  ]);
});

test('a second combine starts from an empty list', async () => {
  // With a document open the home screen is gone; the Tools menu still has it.
  await runTool('Combine Files');
  await expect(page.getByText('No files yet')).toBeVisible();
  await expect(sourceRows()).toHaveCount(0);
});

test('a blank document is made and opened', async () => {
  await saveTo(path.join(sandbox, 'Blank.pdf'));
  await page.getByRole('button', { name: 'Blank document…' }).click();

  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Paper').selectOption('letter');
  await dialog.getByRole('radio', { name: 'Landscape' }).check();
  await dialog.getByLabel('Pages').fill('2');
  await dialog.getByLabel('Title').fill('Something new');
  await dialog.getByRole('button', { name: 'Create…' }).click();

  await expect(page.getByText(/A blank document of 2 pages was made/)).toBeVisible();
  await expect(documentTabs().filter({ hasText: 'Blank.pdf' })).toHaveCount(1);

  const task = getDocument({ data: new Uint8Array(await fs.readFile(output)) });
  const pdf = await task.promise;
  const viewport = (await pdf.getPage(1)).getViewport({ scale: 1 });
  expect(pdf.numPages).toBe(2);
  // Letter, turned on its side.
  expect(Math.round(viewport.width)).toBe(792);
  expect(Math.round(viewport.height)).toBe(612);
  await task.destroy();
});

test('the page setup applies to the files that are not already PDFs', async () => {
  await runTool('Create PDF');
  await addFiles([files['image'] as string]);

  await expect(sourceRows()).toHaveCount(1);
  await page.getByLabel('Paper').selectOption("The image's own size");

  await saveTo(path.join(sandbox, 'Picture.pdf'));
  await page.getByRole('button', { name: 'Create…' }).click();
  await expect(page.getByText(/A document of 1 pages? was made/)).toBeVisible();

  const task = getDocument({ data: new Uint8Array(await fs.readFile(output)) });
  const pdf = await task.promise;
  const viewport = (await pdf.getPage(1)).getViewport({ scale: 1 });
  // The image is 60 × 40, and the margin is 36 points on each side.
  expect(Math.round(viewport.width)).toBe(132);
  expect(Math.round(viewport.height)).toBe(112);
  await task.destroy();
});
