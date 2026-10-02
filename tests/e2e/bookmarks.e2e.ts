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
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFString,
} from 'pdf-lib';
import { navigationDocument } from '../fixtures/pdf';

/**
 * Editing bookmarks in the real application: adding one at the current view,
 * renaming it in place, nesting, restyling, deleting, and finding all of it
 * in the saved file.
 */

const mainBundle = path.resolve('.vite', 'build', 'main.js');
const screenshots = process.env['PAPERFORGE_SCREENSHOTS'];

let app: ElectronApplication;
let page: Page;
let sandbox = '';
let documentPath = '';

function panel(): Locator {
  return page.getByRole('region', { name: 'Bookmarks' });
}

function tool(name: string): Locator {
  return panel().getByRole('toolbar', { name: 'Bookmark tools' }).getByRole('button', { name });
}

interface SavedEntry {
  line: string;
  flags: number;
  colour: number[];
}

/** The outline as the saved file has it, read with nothing but pdf-lib. */
async function readOutline(): Promise<SavedEntry[]> {
  const document = await PDFDocument.load(await fs.readFile(documentPath));
  const pages = document.getPages();
  const entries: SavedEntry[] = [];
  const walk = (first: unknown, depth: number): void => {
    let current = first;
    while (current !== undefined) {
      const item = document.context.lookup(current as never, PDFDict);
      const title = item.lookup(PDFName.of('Title'));
      const text =
        title instanceof PDFString || title instanceof PDFHexString ? title.decodeText() : '';
      const destination = item.lookup(PDFName.of('Dest'));
      const target = destination instanceof PDFArray ? destination.get(0) : undefined;
      const index = pages.findIndex((entry) => entry.ref === target);
      const flags = item.lookup(PDFName.of('F'));
      const colour = item.lookup(PDFName.of('C'));
      entries.push({
        line: `${'  '.repeat(depth)}${text} (${String(index + 1)})`,
        flags: flags instanceof PDFNumber ? flags.asNumber() : 0,
        colour:
          colour instanceof PDFArray
            ? colour.asArray().map((value) => (value as PDFNumber).asNumber())
            : [],
      });
      walk(item.get(PDFName.of('First')), depth + 1);
      current = item.get(PDFName.of('Next'));
    }
  };
  const root = document.catalog.lookupMaybe(PDFName.of('Outlines'), PDFDict);
  if (root !== undefined) walk(root.get(PDFName.of('First')), 0);
  return entries;
}

async function saveAndRead(): Promise<string[]> {
  await page.keyboard.press('Control+s');
  await expect(page.getByLabel('Unsaved changes')).toHaveCount(0);
  return (await readOutline()).map((entry) => entry.line);
}

test.beforeAll(async () => {
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'paperforge-bookmarks-'));
  app = await electron.launch({
    executablePath: electronBinary as unknown as string,
    args: [mainBundle, `--user-data-dir=${path.join(sandbox, 'profile')}`],
  });
  page = await app.firstWindow();
  await page.waitForSelector('[data-focus-region="workspace"]');

  const recovery = page.getByRole('dialog').filter({ hasText: 'Recover documents' });
  if ((await recovery.count()) > 0) await recovery.getByRole('button', { name: 'Discard' }).click();

  documentPath = path.join(sandbox, 'Outlined.pdf');
  await fs.writeFile(documentPath, navigationDocument());
  await page.evaluate(
    (target: string) => window.paperforge.invoke('files:openPaths', { paths: [target] }),
    documentPath,
  );
  await page.getByRole('button', { name: 'Open Outlined.pdf' }).click();
  await expect(page.getByText('Preface about forging paper')).toBeVisible();

  if (!(await panel().isVisible())) await page.getByRole('button', { name: 'Bookmarks' }).click();
  await expect(panel().getByRole('button', { name: /Front matter/ })).toBeVisible();
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

test('adds a bookmark at the current page and names it in place', async () => {
  // Choosing an entry goes to its page, so the place is chosen afterwards.
  await panel().getByRole('button', { name: 'Front matter' }).click();
  await page.getByRole('textbox', { name: 'Page number' }).fill('2');
  await page.keyboard.press('Enter');
  await expect(page.getByText('(4 of 5)')).toBeVisible();

  // After the selected entry, as its sibling.
  await tool('Add bookmark').click();
  const title = panel().getByRole('textbox', { name: 'Bookmark title' });
  await expect(title).toBeFocused();
  await title.fill('Layered notice');
  await title.press('Enter');
  await expect(panel().getByRole('button', { name: 'Layered notice' })).toBeVisible();
  await snapshot('bookmarks');

  expect(await saveAndRead()).toEqual([
    'Front matter (1)',
    'Layered notice (4)',
    'Report (3)',
    '  Findings (3)',
    '  Appendix (5)',
  ]);
});

test('nests, moves, restyles and deletes, each one undoable', async () => {
  await panel().getByRole('button', { name: 'Layered notice' }).click();
  await tool('Move down').click();
  await tool('Nest under the bookmark above').click();
  await tool('Bold').click();
  await panel().getByRole('combobox', { name: 'Bookmark colour' }).selectOption('Green');

  await panel().getByRole('button', { name: 'Front matter' }).click();
  await page.keyboard.press('F2');
  await panel().getByRole('textbox', { name: 'Bookmark title' }).fill('Preface');
  await page.keyboard.press('Enter');

  await panel().getByRole('button', { name: 'Appendix' }).click();
  await tool('Delete bookmark').click();
  await expect(panel().getByRole('button', { name: 'Appendix' })).toHaveCount(0);

  // Undo brings the deleted entry back.
  await page.keyboard.press('Control+z');
  await expect(panel().getByRole('button', { name: 'Appendix' })).toBeVisible();
  await page.keyboard.press('Control+y');
  await expect(panel().getByRole('button', { name: 'Appendix' })).toHaveCount(0);

  expect(await saveAndRead()).toEqual([
    'Preface (1)',
    'Report (3)',
    '  Findings (3)',
    '  Layered notice (4)',
  ]);
  const nested = (await readOutline()).find((entry) => entry.line.includes('Layered notice'));
  // Bold is the second flag; the colour is the green the menu offers.
  expect(nested?.flags).toBe(2);
  expect(nested?.colour).toEqual([0.1, 0.55, 0.2]);
});

async function snapshot(name: string): Promise<void> {
  if (screenshots === undefined) return;
  await page.screenshot({ path: path.join(screenshots, `${name}.png`) });
}
