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
import { organizeDocument, threePageDocument } from '../fixtures/pdf';

const mainBundle = path.resolve('.vite', 'build', 'main.js');

let app: ElectronApplication;
let page: Page;
let sandbox = '';
let documentPath = '';
let insertPath = '';
let secondPath = '';
const imagePath = path.resolve('resources', 'icons', 'icon.png');

/** The words on each page, in page order, as the file on disk has them. */
async function pagesOnDisk(filePath: string): Promise<string[]> {
  const task = getDocument({ data: new Uint8Array(await fs.readFile(filePath)) });
  const pdf = await task.promise;
  const texts: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const content = await (await pdf.getPage(pageNumber)).getTextContent();
    texts.push(
      content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .trim(),
    );
  }
  await task.destroy();
  return texts;
}

/** The rotation the file records for each page. */
async function rotationsOnDisk(filePath: string): Promise<number[]> {
  const task = getDocument({ data: new Uint8Array(await fs.readFile(filePath)) });
  const pdf = await task.promise;
  const rotations: number[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    rotations.push((await pdf.getPage(pageNumber)).rotate);
  }
  await task.destroy();
  return rotations;
}

/** The page grid, which is the only list of pages with named page buttons. */
function grid(): Locator {
  return page.getByRole('list', { name: 'Pages' });
}

/** The document tabs, which the right panel's own tabs must not be mistaken for. */
function documentTabs(): Locator {
  return page.getByRole('tablist', { name: 'Open documents' }).getByRole('tab');
}

function pageCard(pageNumber: number): Locator {
  return grid().getByRole('button', { name: `Page ${String(pageNumber)}`, exact: true });
}

/** Drags one page card onto the right-hand edge of another. */
async function dragPage(from: number, to: number, edge: 'left' | 'right'): Promise<void> {
  const source = await pageCard(from).boundingBox();
  const target = await pageCard(to).boundingBox();
  if (source === null || target === null) throw new Error('a page card was not on screen');

  const x = edge === 'left' ? target.x + 4 : target.x + target.width - 4;
  const y = target.y + target.height / 2;

  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  // Two moves: the first passes the threshold that tells a drag from a click.
  await page.mouse.move(x, y, { steps: 8 });
  await page.mouse.move(x, y);
  await page.mouse.up();
}

async function openDocument(filePath: string, displayName: string): Promise<void> {
  await page.evaluate(
    (target: string) => window.paperforge.invoke('files:openPaths', { paths: [target] }),
    filePath,
  );
  await page.getByRole('button', { name: `Open ${displayName}` }).click();
}

test.beforeAll(async () => {
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'paperforge-organize-'));
  app = await electron.launch({
    executablePath: electronBinary as unknown as string,
    args: [mainBundle, `--user-data-dir=${path.join(sandbox, 'profile')}`],
  });
  page = await app.firstWindow();
  await page.waitForSelector('[data-focus-region="workspace"]');

  // A previous run that was killed rather than closed leaves session
  // directories behind, and PaperForge offers them back before anything else.
  const recovery = page.getByRole('dialog').filter({ hasText: 'Recover documents' });
  if ((await recovery.count()) > 0) await recovery.getByRole('button', { name: 'Discard' }).click();

  documentPath = path.join(sandbox, 'Organize.pdf');
  insertPath = path.join(sandbox, 'Inserted.pdf');
  secondPath = path.join(sandbox, 'Second.pdf');
  await fs.writeFile(documentPath, organizeDocument());
  await fs.writeFile(insertPath, threePageDocument());
  await fs.writeFile(secondPath, threePageDocument());

  await openDocument(documentPath, 'Organize.pdf');
  await expect(page.getByText('Organize page one')).toBeVisible();
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

test('the page grid opens with every page of the document', async () => {
  await page.keyboard.press('Control+Shift+P');

  await expect(grid()).toBeVisible();
  await expect(grid().getByRole('button')).toHaveCount(5);
  await expect(page.getByText('5 pages')).toBeVisible();
});

test('pages are chosen with a click, Ctrl, Shift and Ctrl+A', async () => {
  await pageCard(2).click();
  await expect(page.getByText('1 of 5 selected')).toBeVisible();
  await expect(pageCard(2)).toHaveAttribute('aria-pressed', 'true');

  await pageCard(4).click({ modifiers: ['Shift'] });
  await expect(page.getByText('3 of 5 selected')).toBeVisible();

  await pageCard(3).click({ modifiers: ['Control'] });
  await expect(page.getByText('2 of 5 selected')).toBeVisible();

  await page.keyboard.press('Control+a');
  await expect(page.getByText('5 of 5 selected')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByText('5 pages')).toBeVisible();
});

test('dragging a page moves it in the document but not in the file', async () => {
  const before = await fs.readFile(documentPath);

  // Page 1 dropped after page 3.
  await dragPage(1, 3, 'right');

  await expect(page.getByLabel('Unsaved changes')).toBeVisible();
  await expect(grid().getByRole('button')).toHaveCount(5);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();

  // The reader's file is untouched until they save.
  expect(await fs.readFile(documentPath)).toEqual(before);
});

test('rotating, duplicating and deleting act on the chosen pages', async () => {
  await pageCard(1).click();
  await page.getByRole('button', { name: 'Rotate right' }).click();
  await expect.poll(async () => pageIsLandscape(1)).toBe(true);

  await pageCard(5).click();
  await page.getByRole('button', { name: 'Duplicate pages' }).click();
  await expect(grid().getByRole('button')).toHaveCount(6);

  await pageCard(6).click();
  await page.getByRole('button', { name: 'Delete pages' }).click();
  await expect(grid().getByRole('button')).toHaveCount(5);

  // Every step is one undoable change of its own.
  await page.keyboard.press('Control+z');
  await expect(grid().getByRole('button')).toHaveCount(6);
  await page.keyboard.press('Control+y');
  await expect(grid().getByRole('button')).toHaveCount(5);
});

test('saving writes exactly the order and rotation the grid shows', async () => {
  await page.keyboard.press('Control+s');
  await expect(page.getByText(/Organize\.pdf was saved/)).toBeVisible();

  expect(await pagesOnDisk(documentPath)).toEqual([
    'Organize page two',
    'Organize page three',
    'Organize page one',
    'Organize page four',
    'Organize page five',
  ]);
  expect(await rotationsOnDisk(documentPath)).toEqual([90, 0, 0, 0, 0]);
});

test('the saved document reopens in the saved order', async () => {
  await page.keyboard.press('Control+w');
  await expect(documentTabs()).toHaveCount(0);

  await page.getByRole('button', { name: 'Open Organize.pdf' }).click();
  await expect(page.getByText('Organize page two')).toBeVisible();

  await page.keyboard.press('Control+Shift+P');
  await expect(grid().getByRole('button')).toHaveCount(5);
});

test('extracting pages writes a new document and leaves this one alone', async () => {
  const extracted = path.join(sandbox, 'Extracted.pdf');
  await app.evaluate(({ dialog }, target: string) => {
    dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: target });
  }, extracted);

  await pageCard(1).click();
  await pageCard(2).click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Extract pages' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Pages 1-2');
  await dialog.getByRole('button', { name: 'Extract…' }).click();

  await expect(page.getByText('The pages were written to a new document.')).toBeVisible();
  expect(await pagesOnDisk(extracted)).toEqual(['Organize page two', 'Organize page three']);

  // The document the pages came from still has all five, and is unchanged.
  await expect(grid().getByRole('button')).toHaveCount(5);
  await expect(page.getByLabel('Unsaved changes')).toBeHidden();
});

test('inserting pages from another PDF adds them where they were asked for', async () => {
  await app.evaluate(({ dialog }, target: string) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [target] });
  }, insertPath);

  await pageCard(1).click();
  await page.getByRole('button', { name: 'Insert pages' }).click();
  await page.getByRole('menuitem', { name: 'Pages from a PDF…' }).click();

  await expect(grid().getByRole('button')).toHaveCount(8);
  await expect(page.getByLabel('Unsaved changes')).toBeVisible();

  await page.keyboard.press('Control+z');
  await expect(grid().getByRole('button')).toHaveCount(5);
  await expect(page.getByLabel('Unsaved changes')).toBeHidden();
});

test('a blank page can be added and the numbering changed', async () => {
  await pageCard(5).click();
  await page.getByRole('button', { name: 'Insert pages' }).click();
  await page.getByRole('menuitem', { name: 'Blank page' }).click();
  await expect(grid().getByRole('button')).toHaveCount(6);

  await pageCard(1).click();
  await page.getByRole('button', { name: 'Page numbering' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Style').selectOption('romanLower');
  await dialog.getByRole('button', { name: 'Apply' }).click();

  // The grid shows the printed number beside the page's position.
  await expect(grid().getByText('iii', { exact: true })).toBeVisible();

  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await expect(grid().getByRole('button')).toHaveCount(5);
  await expect(page.getByLabel('Unsaved changes')).toBeHidden();
});

test('splitting lists the pieces it would write, by bookmark as well', async () => {
  const folder = path.join(sandbox, 'split');
  await fs.mkdir(folder, { recursive: true });
  await app.evaluate(({ dialog }, target: string) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [target] });
  }, folder);

  await page.getByRole('button', { name: 'Split document' }).click();
  const dialog = page.getByRole('dialog');

  // Every page on its own is the default; the preview says so.
  await expect(dialog.getByRole('listitem')).toHaveCount(5);

  // The two bookmarks followed their pages through the reorder above: they now
  // start on pages 2 and 3, so the first page is a piece of its own.
  await dialog.getByRole('radio', { name: /Top-level bookmarks/ }).check();
  await expect(dialog.getByRole('listitem')).toHaveCount(3);
  await expect(dialog.getByText('Organize Beginning.pdf')).toBeVisible();

  // Written by page count, so the files are simple to check.
  await dialog.getByRole('radio', { name: /A number of pages/ }).check();
  await dialog.getByRole('spinbutton', { name: 'Pages in each document' }).fill('2');
  await dialog.getByRole('button', { name: /Write 3 documents…/ }).click();
  await expect(page.getByText('3 documents were written.')).toBeVisible();

  const written = (await fs.readdir(folder)).sort();
  expect(written).toEqual(['Organize 1-2.pdf', 'Organize 3-4.pdf', 'Organize 5.pdf']);
  expect(await pagesOnDisk(path.join(folder, 'Organize 1-2.pdf'))).toEqual([
    'Organize page two',
    'Organize page three',
  ]);
  expect(await pagesOnDisk(path.join(folder, 'Organize 5.pdf'))).toEqual(['Organize page five']);
});

test('an image becomes a page of its own', async () => {
  await app.evaluate(({ dialog }, target: string) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [target] });
  }, imagePath);

  await pageCard(2).click();
  await page.getByRole('button', { name: 'Insert pages' }).click();
  await page.getByRole('menuitem', { name: 'Image as a page…' }).click();

  await expect(grid().getByRole('button')).toHaveCount(6);
  // The image is centred on a page of its own rather than drawn on page 2.
  await expect(pageCard(3).locator('canvas')).toBeVisible();

  await page.keyboard.press('Control+z');
  await expect(grid().getByRole('button')).toHaveCount(5);
});

test('pages move into another open document, and leave this one', async () => {
  await app.evaluate(({ dialog }, target: string) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [target] });
  }, secondPath);

  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(documentTabs()).toHaveCount(2);
  // The grid stays open across a tab switch: it is a way of working, not a view
  // of one document.
  await expect(grid().getByRole('button')).toHaveCount(3);

  await pageCard(1).click();
  await pageCard(2).click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Move pages to another document' }).click();
  await page.getByRole('menuitem', { name: 'Organize.pdf' }).click();

  await expect(page.getByText('2 pages moved to Organize.pdf.')).toBeVisible();
  await expect(grid().getByRole('button')).toHaveCount(1);

  // And they really arrived: the other document has them at its end.
  await documentTabs().filter({ hasText: 'Organize.pdf' }).click();
  await expect(grid().getByRole('button')).toHaveCount(7);

  // Each document undoes its own half of the move.
  await page.keyboard.press('Control+z');
  await expect(grid().getByRole('button')).toHaveCount(5);
  await documentTabs().filter({ hasText: 'Second.pdf' }).click();
  await page.keyboard.press('Control+z');
  await expect(grid().getByRole('button')).toHaveCount(3);

  await page.keyboard.press('Control+w');
  await expect(documentTabs()).toHaveCount(1);
});

test('the page boxes of the chosen page are shown, and cropping changes them', async () => {
  const properties = page.getByRole('region', { name: 'Properties and tools' });
  // F4 toggles the panel, so only press it when it is not already there.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  if ((await properties.count()) === 0) await page.keyboard.press('F4');
  await pageCard(1).click();
  await expect(properties).toContainText('MediaBox');
  await expect(properties).toContainText('612 × 792 pt');
  await expect(properties).toContainText('Not set');

  await page.getByRole('button', { name: 'Crop pages' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Left').fill('72');
  await dialog.getByLabel('Top').fill('72');
  await dialog.getByRole('button', { name: 'Apply' }).click();

  await expect(properties).toContainText('540 × 720 pt');
  await expect(page.getByLabel('Unsaved changes')).toBeVisible();

  await page.getByRole('button', { name: 'Crop pages' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Reset crop' }).click();
  await expect(properties).toContainText('612 × 792 pt');
});

test('leaving the grid goes back to reading the same document', async () => {
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(grid()).toBeHidden();
  await expect(page.getByText('Organize page two')).toBeVisible();
});

/** Whether the grid draws a page wider than it is tall, which a rotation does. */
async function pageIsLandscape(pageNumber: number): Promise<boolean> {
  const box = await pageCard(pageNumber).locator('canvas').boundingBox();
  return box !== null && box.width > box.height;
}
