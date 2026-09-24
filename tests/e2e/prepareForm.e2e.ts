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

function toolbar(): Locator {
  return page.getByRole('toolbar', { name: 'Prepare form' });
}

function properties(): Locator {
  return page.getByRole('region', { name: 'Properties and tools' });
}

function fields(): Locator {
  return page.getByLabel('Page 1').locator('[data-design-field]');
}

/** Drags a box on the page, in a part of it that is empty. */
async function drawField(downwards: number): Promise<void> {
  const box = await page.getByLabel('Page 1').boundingBox();
  if (box === null) throw new Error('the page has no box on screen');
  const height = await page.evaluate(() => window.innerHeight);
  const y = Math.min(box.y + box.height * downwards, height - 160);

  await page.mouse.move(box.x + box.width * 0.2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.55, y + 26, { steps: 8 });
  await page.mouse.up();
}

test.beforeAll(async () => {
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'paperforge-prepare-'));
  app = await electron.launch({
    executablePath: electronBinary as unknown as string,
    args: [mainBundle, `--user-data-dir=${path.join(sandbox, 'profile')}`],
  });
  page = await app.firstWindow();
  await page.waitForSelector('[data-focus-region="workspace"]');

  const recovery = page.getByRole('dialog').filter({ hasText: 'Recover documents' });
  if ((await recovery.count()) > 0) await recovery.getByRole('button', { name: 'Discard' }).click();

  // A plain document with no form at all: the form is made here.
  documentPath = path.join(sandbox, 'Blank.pdf');
  await fs.writeFile(documentPath, buildPdf({ pages: [{ text: 'Membership form' }] }));

  await page.evaluate(
    (target: string) => window.paperforge.invoke('files:openPaths', { paths: [target] }),
    documentPath,
  );
  await page.getByRole('button', { name: 'Open Blank.pdf' }).click();
  await expect(page.getByLabel('Page 1')).toBeVisible();

  await page.keyboard.press('Control+k');
  await page.getByPlaceholder('Search commands').fill('Prepare Form');
  await page.getByRole('option').filter({ hasText: 'Prepare Form' }).first().click();
  await expect(toolbar()).toBeVisible();
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

test('a document with no form says so, and offers the kinds of field', async () => {
  await expect(toolbar()).toContainText('No fields yet');
  await expect(toolbar().getByRole('button', { name: 'Text field' })).toBeVisible();
  await expect(fields()).toHaveCount(0);
});

test('dragging with a kind chosen draws a field there', async () => {
  await toolbar().getByRole('button', { name: 'Text field' }).click();
  await drawField(0.2);

  await expect(fields()).toHaveCount(1);
  await expect(page.getByLabel('Unsaved changes')).toBeVisible();
  // The new field is selected, and the panel is about it.
  await expect(properties().getByLabel('Field name')).toHaveValue('text1');
});

test('the panel names it, and says what it will accept', async () => {
  await properties().getByLabel('Field name').fill('member.name');
  await properties().getByLabel('Tooltip').fill('Your full name');
  await properties().getByRole('checkbox', { name: 'Required' }).check();
  await properties().getByRole('button', { name: 'Apply' }).click();

  await expect(properties().getByLabel('Field name')).toHaveValue('member.name');
  await expect(fields().first()).toHaveAttribute('title', /member\.name/);
});

test('a checkbox and a dropdown can be added too', async () => {
  await toolbar().getByRole('button', { name: 'Checkbox' }).click();
  await drawField(0.35);
  await expect(fields()).toHaveCount(2);

  await toolbar().getByRole('button', { name: 'Dropdown' }).click();
  await drawField(0.5);
  await expect(fields()).toHaveCount(3);

  // A dropdown starts with options, and they can be rewritten.
  await expect(properties().getByLabel('Options')).toHaveValue('Option 1\nOption 2');
  await properties().getByLabel('Options').fill('Gold\nSilver');
  await properties().getByRole('button', { name: 'Apply' }).click();
  await expect(properties().getByLabel('Options')).toHaveValue('Gold\nSilver');
});

test('a field can be dragged to another place', async () => {
  const before = await fields().first().boundingBox();
  if (before === null) throw new Error('the field has no box on screen');

  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 + 60, before.y + before.height / 2, {
    steps: 8,
  });
  await page.mouse.up();

  await expect
    .poll(async () => {
      const box = await fields().first().boundingBox();
      return box === null ? null : Math.round(box.x);
    })
    .toBeGreaterThan(Math.round(before.x) + 20);
});

test('the form is in the file, and can be filled in after saving', async () => {
  await page.keyboard.press('Control+s');
  await expect(page.getByText(/Blank\.pdf was saved/)).toBeVisible();

  await toolbar().getByRole('button', { name: 'Done' }).click();
  await page.keyboard.press('Control+Shift+F');
  await expect(page.getByRole('toolbar', { name: 'Fill and sign' })).toBeVisible();

  const field = page.locator('[data-field="member.name"]');
  await expect(field).toBeVisible();
  await field.fill('Ada Lovelace');
  await page.keyboard.press('Enter');
  await expect(field).toHaveValue('Ada Lovelace');
});

test('a field can be taken away again', async () => {
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder('Search commands').fill('Prepare Form');
  await page.getByRole('option').filter({ hasText: 'Prepare Form' }).first().click();
  await expect(toolbar()).toBeVisible();

  await fields().first().click();
  await properties().getByRole('button', { name: 'Delete' }).click();

  await expect(fields()).toHaveCount(2);
});
