import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Locator,
  type Page,
} from '@playwright/test';
import electronBinary from 'electron';
import { PDFDocument } from 'pdf-lib';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildFormPdf } from '../fixtures/forms';

const mainBundle = path.resolve('.vite', 'build', 'main.js');

let app: ElectronApplication;
let page: Page;
let sandbox = '';
let documentPath = '';

/** What a field holds in the file on disk. */
async function valueOnDisk(filePath: string, name: string): Promise<unknown> {
  const document = await PDFDocument.load(new Uint8Array(await fs.readFile(filePath)), {
    updateMetadata: false,
  });
  const form = document.getForm();
  const field = form.getFieldMaybe(name);
  if (field === undefined) return undefined;

  const type = field.constructor.name;
  if (type === 'PDFTextField') return form.getTextField(name).getText();
  if (type === 'PDFCheckBox') return form.getCheckBox(name).isChecked();
  if (type === 'PDFRadioGroup') return form.getRadioGroup(name).getSelected();
  if (type === 'PDFDropdown') return form.getDropdown(name).getSelected();
  return undefined;
}

function field(name: string): Locator {
  return page.locator(`[data-field="${name}"]`);
}

function toolbar(): Locator {
  return page.getByRole('toolbar', { name: 'Fill and sign' });
}

async function openFillSign(): Promise<void> {
  if ((await toolbar().count()) === 0) await page.keyboard.press('Control+Shift+F');
  await expect(toolbar()).toBeVisible();
}

test.beforeAll(async () => {
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'paperforge-forms-'));
  app = await electron.launch({
    executablePath: electronBinary as unknown as string,
    args: [mainBundle, `--user-data-dir=${path.join(sandbox, 'profile')}`],
  });
  page = await app.firstWindow();
  await page.waitForSelector('[data-focus-region="workspace"]');

  const recovery = page.getByRole('dialog').filter({ hasText: 'Recover documents' });
  if ((await recovery.count()) > 0) await recovery.getByRole('button', { name: 'Discard' }).click();

  documentPath = path.join(sandbox, 'Application.pdf');
  await fs.writeFile(
    documentPath,
    await buildFormPdf({ requireName: true, tooltip: 'Your full name' }),
  );

  await page.evaluate(
    (target: string) => window.paperforge.invoke('files:openPaths', { paths: [target] }),
    documentPath,
  );
  await page.getByRole('button', { name: 'Open Application.pdf' }).click();
  await expect(page.getByLabel('Page 1')).toBeVisible();
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

test('the fields of the form become controls on the page', async () => {
  await openFillSign();

  await expect(page.locator('[data-field]')).toHaveCount(7);
  await expect(field('person.name')).toHaveValue('Ada');
  await expect(field('person.name')).toHaveAttribute('title', 'Your full name');
  // A radio group is one control for each of its options.
  await expect(field('person.plan')).toHaveCount(2);
});

test('the panel says what the selected field will accept', async () => {
  await field('person.name').click();

  const properties = page.getByRole('region', { name: 'Properties and tools' });
  await expect(properties).toContainText('person.name');
  await expect(properties).toContainText('40 characters');
  await expect(properties).toContainText('Must be filled in');
});

test('typing is written when the field is left, as one change', async () => {
  await field('person.name').fill('Grace Hopper');
  await expect(page.getByLabel('Unsaved changes')).toBeHidden();

  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Unsaved changes')).toBeVisible();
  await expect(field('person.name')).toHaveValue('Grace Hopper');

  await page.keyboard.press('Control+z');
  await expect(field('person.name')).toHaveValue('Ada');
  await page.keyboard.press('Control+y');
  await expect(field('person.name')).toHaveValue('Grace Hopper');
});

test('ticking, choosing and picking are written straight away', async () => {
  await field('person.member').check();
  await expect(field('person.member')).toBeChecked();

  await field('person.plan').nth(1).check();
  await expect(field('person.plan').nth(1)).toBeChecked();

  await field('person.country').selectOption('Japan');
  await expect(field('person.country')).toHaveValue('Japan');
});

test('the toolbar says what is still required', async () => {
  await expect(toolbar()).toContainText('nothing required is missing');
});

test('what was filled in is in the file, and comes back on reopening', async () => {
  await page.keyboard.press('Control+s');
  await expect(page.getByText(/Application\.pdf was saved/)).toBeVisible();

  expect(await valueOnDisk(documentPath, 'person.name')).toBe('Grace Hopper');
  expect(await valueOnDisk(documentPath, 'person.member')).toBe(true);
  expect(await valueOnDisk(documentPath, 'person.plan')).toBe('full');
  expect(await valueOnDisk(documentPath, 'person.country')).toEqual(['Japan']);

  await page.keyboard.press('Control+w');
  await page.getByRole('button', { name: 'Open Application.pdf' }).click();
  await expect(page.getByLabel('Page 1')).toBeVisible();
  await openFillSign();
  await expect(field('person.name')).toHaveValue('Grace Hopper');
  await expect(field('person.member')).toBeChecked();
});

test('emptying the form clears what can be changed, and can be undone', async () => {
  await toolbar().getByRole('button', { name: 'Empty the form' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Empty the form' }).click();

  await expect(field('person.name')).toHaveValue('');
  await expect(field('person.member')).not.toBeChecked();

  await page.keyboard.press('Control+z');
  await expect(field('person.name')).toHaveValue('Grace Hopper');
});

test('flattening draws the fields onto the page and leaves nothing to fill in', async () => {
  await field('person.name').fill('Grace Hopper');
  await page.keyboard.press('Enter');

  await toolbar().getByRole('button', { name: 'Flatten' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Form fields');
  // Change this document rather than writing a copy, so the test can see it.
  await dialog.getByRole('radio', { name: /Change this document/ }).check();
  await dialog.getByRole('button', { name: 'Flatten', exact: true }).click();

  await expect(page.locator('[data-field]')).toHaveCount(0);
  await expect(toolbar()).toContainText('no form fields');

  // What was filled in is still on the page, drawn rather than filled.
  await expect(page.getByLabel('Page 1').getByText('Grace Hopper')).toBeVisible();

  await page.keyboard.press('Control+z');
  await expect(page.locator('[data-field]')).toHaveCount(7);
});

test('leaving Fill & Sign goes back to reading the document', async () => {
  await toolbar().getByRole('button', { name: 'Done' }).click();

  await expect(toolbar()).toHaveCount(0);
  await expect(page.locator('[data-field]')).toHaveCount(0);
});
