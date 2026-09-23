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
import { buildPdf } from '../fixtures/pdf';

const mainBundle = path.resolve('.vite', 'build', 'main.js');

let app: ElectronApplication;
let page: Page;
let sandbox = '';
let documentPath = '';

function linksOn(pageNumber: number): Locator {
  return page.getByLabel(`Page ${String(pageNumber)}`).locator('[data-link]');
}

function properties(): Locator {
  return page.getByRole('region', { name: 'Properties and tools' });
}

function toolbar(): Locator {
  return page.getByRole('toolbar', { name: 'Editing' });
}

async function openLinkEditor(): Promise<void> {
  if ((await toolbar().count()) === 0) await page.keyboard.press('Control+e');
  await expect(toolbar()).toBeVisible();
  await toolbar().getByRole('button', { name: 'Edit links' }).click();
}

test.beforeAll(async () => {
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'paperforge-links-'));
  app = await electron.launch({
    executablePath: electronBinary as unknown as string,
    args: [mainBundle, `--user-data-dir=${path.join(sandbox, 'profile')}`],
  });
  page = await app.firstWindow();
  await page.waitForSelector('[data-focus-region="workspace"]');

  const recovery = page.getByRole('dialog').filter({ hasText: 'Recover documents' });
  if ((await recovery.count()) > 0) await recovery.getByRole('button', { name: 'Discard' }).click();

  documentPath = path.join(sandbox, 'Linked.pdf');
  await fs.writeFile(
    documentPath,
    buildPdf({
      pages: [
        {
          text: 'The first page',
          annotations: [
            '<< /Type /Annot /Subtype /Link /Rect [ 60 600 260 640 ] ' +
              '/A << /S /URI /URI (https://example.org/start) >> >>',
          ],
        },
        { text: 'The second page' },
      ],
    }),
  );

  await page.evaluate(
    (target: string) => window.paperforge.invoke('files:openPaths', { paths: [target] }),
    documentPath,
  );
  await page.getByRole('button', { name: 'Open Linked.pdf' }).click();
  await expect(page.getByText('The first page')).toBeVisible();
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

test('the editor shows the links the page already carries', async () => {
  await openLinkEditor();

  await expect(linksOn(1)).toHaveCount(1);
  await expect(linksOn(1).first()).toHaveAttribute('title', 'https://example.org/start');
});

test('selecting one says where it goes', async () => {
  await linksOn(1).first().click();

  await expect(properties()).toContainText('https://example.org/start');
  await expect(properties()).toContainText('200 × 40 pt');
});

test('it can be pointed at a page of this document instead', async () => {
  await properties().getByRole('radio', { name: 'A page' }).check();
  await properties().getByRole('spinbutton', { name: 'Page' }).fill('2');
  await properties().getByRole('button', { name: 'Apply' }).click();

  await expect(properties()).toContainText('Page 2 of this document');
  await expect(page.getByLabel('Unsaved changes')).toBeVisible();
});

test('an address PaperForge will not write is refused before it is written', async () => {
  await properties().getByRole('radio', { name: 'A web address' }).check();
  await properties().getByRole('textbox', { name: 'Web address' }).fill('javascript:alert(1)');

  await expect(properties()).toContainText('http://, https:// or mailto:');
  await expect(properties().getByRole('button', { name: 'Apply' })).toBeDisabled();
});

test('a new link is drawn over an area of the page', async () => {
  await toolbar().getByRole('button', { name: 'Add link' }).click();
  const box = await page.getByLabel('Page 1').boundingBox();
  if (box === null) throw new Error('the page has no box on screen');

  await page.mouse.move(box.x + 100, box.y + 400);
  await page.mouse.down();
  await page.mouse.move(box.x + 260, box.y + 450, { steps: 8 });
  await page.mouse.up();

  await expect(linksOn(1)).toHaveCount(2);
  // A new link points at the page it was drawn on until it is told otherwise.
  await expect(properties()).toContainText('Page 1 of this document');
  await expect(properties()).toContainText('By PaperForge');
});

test('dragging a link moves it', async () => {
  const before = await linksOn(1).last().boundingBox();
  if (before === null) throw new Error('the link has no box on screen');

  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 + 60, before.y + before.height / 2, {
    steps: 8,
  });
  await page.mouse.up();

  await expect
    .poll(async () => {
      const box = await linksOn(1).last().boundingBox();
      return box === null ? null : Math.round(box.x);
    })
    .toBeGreaterThan(Math.round(before.x) + 30);
});

test('the links are still there when the document is saved and reopened', async () => {
  await page.keyboard.press('Control+s');
  await expect(page.getByText(/Linked\.pdf was saved/)).toBeVisible();

  await page.keyboard.press('Control+w');
  await page.getByRole('button', { name: 'Open Linked.pdf' }).click();
  await expect(page.getByLabel('Page 1').getByText('The first page')).toBeVisible();

  await openLinkEditor();
  await expect(linksOn(1)).toHaveCount(2);
});

test('deleting one takes it off the page', async () => {
  await linksOn(1).last().click();
  await properties().getByRole('button', { name: 'Delete' }).click();

  await expect(linksOn(1)).toHaveCount(1);
});
