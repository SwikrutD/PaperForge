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
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { threePageDocument } from '../fixtures/pdf';

const mainBundle = path.resolve('.vite', 'build', 'main.js');

let app: ElectronApplication;
let page: Page;
let sandbox = '';
let documentPath = '';

async function open(filePath: string, displayName: string): Promise<void> {
  await page.evaluate(
    (target: string) => window.paperforge.invoke('files:openPaths', { paths: [target] }),
    filePath,
  );
  for (let guard = 0; guard < 10 && (await page.getByRole('tab').count()) > 0; guard += 1) {
    await page.keyboard.press('Control+w');
    await page.waitForTimeout(150);
  }
  await page.getByRole('button', { name: `Open ${displayName}` }).click();
}

function firstPage(): Locator {
  return page.locator('[data-page-number="1"]');
}

/** Selects the words on the first page, the way a reader drags across them. */
async function selectFirstPageText(): Promise<void> {
  const text = firstPage().getByText('PaperForge alpha page');
  const box = await text.boundingBox();
  if (box === null) throw new Error('the page text was not found');

  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
}

/** The list of comments, which is what the panel is for. */
function comments(): Locator {
  return page.getByRole('list', { name: 'Comments' });
}

/** One row of the comments list, by the kind of comment it shows. */
function row(kind: string): Locator {
  return comments().locator('li').filter({ hasText: kind });
}

/** Shows the comment tools, whatever state the last test left them in. */
async function showCommentTools(): Promise<void> {
  const toolbar = page.getByRole('toolbar', { name: 'Comment tools' });
  if (!(await toolbar.isVisible())) await page.keyboard.press('Control+m');
  await expect(toolbar).toBeVisible();
}

/** The comments panel, which is a tab of the right-hand panel. */
async function showCommentsPanel(): Promise<void> {
  const tab = page.getByRole('tab', { name: 'Comments', exact: true });
  // The panel itself may be closed, in which case the tab is not there yet.
  if (!(await tab.isVisible())) await page.keyboard.press('F4');
  await tab.click();
  await expect(comments().or(page.getByText('No comments'))).toBeVisible();
}

/** Drags inside the first page, in its own coordinates. */
async function dragOnPage(
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  const box = await firstPage().boundingBox();
  if (box === null) throw new Error('the page was not mounted');

  await page.mouse.move(box.x + from.x, box.y + from.y);
  await page.mouse.down();
  await page.mouse.move(box.x + to.x, box.y + to.y, { steps: 10 });
  await page.mouse.up();
}

/** What the annotations in the file on disk actually are. */
async function annotationsOnDisk(
  filePath: string,
): Promise<{ subtype: string; contents: string; hasAppearance: boolean }[]> {
  const task = getDocument({ data: new Uint8Array(await fs.readFile(filePath)) });
  const document = await task.promise;
  const found: { subtype: string; contents: string; hasAppearance: boolean }[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const annotations = (await (
      await document.getPage(pageNumber)
    ).getAnnotations({
      intent: 'display',
    })) as Array<{ subtype: string; contentsObj?: { str: string }; hasAppearance: boolean }>;
    for (const annotation of annotations) {
      found.push({
        subtype: annotation.subtype,
        contents: annotation.contentsObj?.str ?? '',
        hasAppearance: annotation.hasAppearance,
      });
    }
  }
  await task.destroy();
  return found;
}

/** How much colour is on the page, which is how a highlight is visible here. */
async function colouredPixels(): Promise<number> {
  return firstPage()
    .locator('canvas')
    .evaluate((element) => {
      const canvas = element as HTMLCanvasElement;
      const context = canvas.getContext('2d');
      if (context === null) return -1;
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      let coloured = 0;
      for (let index = 0; index < data.length; index += 4) {
        const r = data[index] ?? 255;
        const g = data[index + 1] ?? 255;
        const b = data[index + 2] ?? 255;
        // Neither white nor grey: the page itself is both.
        if (Math.max(r, g, b) - Math.min(r, g, b) > 40) coloured += 1;
      }
      return coloured;
    });
}

test.beforeAll(async () => {
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'paperforge-comments-'));
  app = await electron.launch({
    executablePath: electronBinary as unknown as string,
    args: [mainBundle, `--user-data-dir=${path.join(sandbox, 'profile')}`],
  });
  page = await app.firstWindow();
  await page.waitForSelector('[data-focus-region="workspace"]');

  documentPath = path.join(sandbox, 'Comments.pdf');
  await fs.writeFile(documentPath, threePageDocument());
  await open(documentPath, 'Comments.pdf');
  await expect(page.getByText('PaperForge alpha page')).toBeVisible();
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

test('highlighting selected text marks the page and lists the comment', async () => {
  const before = await colouredPixels();

  await showCommentTools();
  await page.getByRole('button', { name: 'Highlight', exact: true }).click();
  await selectFirstPageText();

  // The highlight is drawn by the PDF engine from the file, so the page itself
  // changes colour.
  await expect.poll(async () => colouredPixels(), { timeout: 15_000 }).toBeGreaterThan(before);
  await expect(page.getByLabel('Unsaved changes')).toBeVisible();

  await showCommentsPanel();
  await expect(comments().getByText('highlight', { exact: true })).toBeVisible();
});

test('a drawn rectangle becomes a comment too', async () => {
  await showCommentTools();
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await dragOnPage({ x: 80, y: 260 }, { x: 240, y: 360 });

  await expect(comments().getByText('rectangle', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
});

test('a comment can be written on, marked done and found again', async () => {
  const rectangle = row('rectangle');
  await rectangle.getByText('rectangle', { exact: true }).click();

  await rectangle.getByRole('button', { name: 'Add a note…' }).click();
  await rectangle.getByRole('textbox', { name: 'Comment text' }).fill('Check this table');
  await rectangle.getByRole('textbox', { name: 'Comment text' }).blur();
  await expect(rectangle.getByText('Check this table')).toBeVisible();

  await rectangle.getByRole('button', { name: 'Mark as done' }).click();
  // The filter proves the status was really stored.
  await page.getByLabel('Status').selectOption('resolved');
  await expect(comments().getByText('rectangle', { exact: true })).toBeVisible();
  await page.getByLabel('Status').selectOption('all');
});

test('the comments are written into the PDF itself', async () => {
  await page.keyboard.press('Control+s');
  await expect(page.getByText(/Comments\.pdf was saved/)).toBeVisible();

  const annotations = await annotationsOnDisk(documentPath);
  expect(annotations.map((annotation) => annotation.subtype).sort()).toEqual([
    'Highlight',
    'Square',
  ]);
  // Every one carries an appearance, so any reader draws what PaperForge drew.
  expect(annotations.every((annotation) => annotation.hasAppearance)).toBe(true);
  expect(annotations.some((annotation) => annotation.contents === 'Check this table')).toBe(true);
});

test('the comments come back when the document is reopened', async () => {
  await page.keyboard.press('Control+w');
  await expect(page.getByRole('tab', { name: /\.pdf/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'Open Comments.pdf' }).click();
  await expect(page.getByText('PaperForge alpha page')).toBeVisible();

  await showCommentsPanel();
  await expect(comments().getByText('Check this table')).toBeVisible();
  await expect(comments().getByText('highlight', { exact: true })).toBeVisible();
});

test('deleting a comment removes it, and undo brings it back', async () => {
  await showCommentsPanel();
  await row('rectangle').getByRole('button', { name: 'Delete comment' }).click();
  await expect(comments().getByText('Check this table')).toBeHidden();

  await page.keyboard.press('Control+z');
  await expect(comments().getByText('Check this table')).toBeVisible();
});

test('a drawing is made freehand and rubbed out again', async () => {
  await showCommentTools();
  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  await dragOnPage({ x: 90, y: 420 }, { x: 260, y: 470 });

  await showCommentsPanel();
  await expect(comments().getByText('drawing', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Erase drawing' }).click();
  const box = await firstPage().boundingBox();
  if (box === null) throw new Error('the page was not mounted');
  await page.mouse.click(box.x + 175, box.y + 445);

  await expect(comments().getByText('drawing', { exact: true })).toBeHidden();
  await page.keyboard.press('Escape');
});

test('the tools can be put away again', async () => {
  await showCommentTools();
  await page.keyboard.press('Control+m');
  await expect(page.getByRole('toolbar', { name: 'Comment tools' })).toBeHidden();
});
