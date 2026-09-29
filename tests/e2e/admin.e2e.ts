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

function dialog(): Locator {
  return page.getByRole('dialog');
}

async function openTool(name: string): Promise<void> {
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder('Search commands').fill(name);
  await page.getByRole('option').filter({ hasText: name }).first().click();
  await expect(dialog()).toBeVisible();
}

/** What the file on disk records about itself. */
async function metadataOnDisk(filePath: string): Promise<Record<string, unknown>> {
  const task = getDocument({ data: new Uint8Array(await fs.readFile(filePath)) });
  const pdf = await task.promise;
  const { info } = await pdf.getMetadata();
  await task.destroy();
  return info as Record<string, unknown>;
}

test.beforeAll(async () => {
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'paperforge-admin-'));
  app = await electron.launch({
    executablePath: electronBinary as unknown as string,
    args: [mainBundle, `--user-data-dir=${path.join(sandbox, 'profile')}`],
  });
  page = await app.firstWindow();
  await page.waitForSelector('[data-focus-region="workspace"]');

  const recovery = page.getByRole('dialog').filter({ hasText: 'Recover documents' });
  if ((await recovery.count()) > 0) await recovery.getByRole('button', { name: 'Discard' }).click();

  documentPath = path.join(sandbox, 'Contract.pdf');
  await fs.writeFile(
    documentPath,
    buildPdf({
      pages: [{ text: 'First page' }, { text: 'Second page' }],
      info: { Title: 'Draft contract', Author: 'A. Writer', Department: 'Legal' },
      attachments: [{ fileName: 'schedule.txt', content: 'the appendix' }],
      javaScript: { Startup: 'app.alert("hello");' },
    }),
  );

  await page.evaluate(
    (target: string) => window.paperforge.invoke('files:openPaths', { paths: [target] }),
    documentPath,
  );
  await page.getByRole('button', { name: 'Open Contract.pdf' }).click();
  await expect(page.getByText('First page')).toBeVisible();
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

test('document properties show what the document says about itself', async () => {
  await openTool('Document Properties');

  await expect(dialog().getByLabel('Title')).toHaveValue('Draft contract');
  await expect(dialog().getByLabel('Author')).toHaveValue('A. Writer');
  await expect(dialog().getByLabel('Custom entry 1 name')).toHaveValue('Department');

  // The fonts the pages actually name, and whether they travel with the file.
  await dialog().getByRole('tab', { name: 'Fonts' }).click();
  await expect(dialog().getByRole('cell', { name: 'Helvetica' })).toBeVisible();

  await dialog().getByRole('tab', { name: 'Advanced' }).click();
  await expect(dialog()).toContainText('612 × 792 pt (2 pages)');

  await dialog().getByRole('button', { name: 'Done' }).click();
});

test('an unprotected document says so rather than implying otherwise', async () => {
  await openTool('Document Properties');
  await dialog().getByRole('tab', { name: 'Security' }).click();

  await expect(dialog()).toContainText('No security');
  await expect(dialog()).toContainText('Anyone can open this document');

  await dialog().getByRole('button', { name: 'Done' }).click();
});

test('editing the title is undoable and reaches the file when it is saved', async () => {
  await openTool('Document Properties');
  await dialog().getByLabel('Title').fill('Signed contract');
  await dialog().getByLabel('Subject').fill('Terms of engagement');
  await dialog().getByRole('button', { name: 'Apply changes' }).click();

  await expect(page.getByLabel('Unsaved changes')).toBeVisible();

  // Undo puts it back, which is what makes this an edit and not a rewrite.
  await page.keyboard.press('Control+z');
  await openTool('Document Properties');
  await expect(dialog().getByLabel('Title')).toHaveValue('Draft contract');
  await dialog().getByRole('button', { name: 'Done' }).click();

  await page.keyboard.press('Control+y');
  await page.keyboard.press('Control+s');
  await expect(page.getByText(/Contract\.pdf was saved/)).toBeVisible();

  const info = await metadataOnDisk(documentPath);
  expect(info['Title']).toBe('Signed contract');
  expect(info['Subject']).toBe('Terms of engagement');
});

test('attachments are listed, and never opened', async () => {
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder('Search commands').fill('Attachments');
  await page.getByRole('option').filter({ hasText: 'Attachments' }).first().click();

  const panel = page.getByRole('region', { name: 'Attachments' });
  await expect(panel.getByText('schedule.txt')).toBeVisible();
  await expect(panel).toContainText('never opens one');
});

test('removing an attachment takes it out of the document', async () => {
  const panel = page.getByRole('region', { name: 'Attachments' });
  await panel.getByRole('button', { name: 'Remove schedule.txt' }).click();

  const confirmation = page.getByRole('dialog').filter({ hasText: 'Remove this attachment?' });
  await confirmation.getByRole('button', { name: 'Remove' }).click();

  await expect(panel.getByText('schedule.txt')).toHaveCount(0);
  await expect(panel).toContainText('carries no embedded files');
});

test('the scan says what is hidden, and removes only what was chosen', async () => {
  await openTool('Remove Hidden Information');

  await expect(dialog()).toContainText('Document metadata');
  await expect(dialog()).toContainText('Document JavaScript');
  await expect(dialog()).toContainText('PaperForge has not run them');

  // Only the scripts go; the title stays.
  await dialog().getByRole('checkbox', { name: 'Document metadata' }).uncheck();
  await dialog().getByRole('radio', { name: 'Change this document' }).check();
  await dialog().getByRole('button', { name: 'Remove', exact: true }).click();

  await openTool('Remove Hidden Information');
  await expect(dialog().getByRole('checkbox', { name: 'Document JavaScript' })).toBeDisabled();
  await expect(dialog().getByRole('checkbox', { name: 'Document metadata' })).toBeEnabled();
  await dialog().getByRole('button', { name: 'Cancel' }).click();
});

test('Protect explains itself before anything is written', async () => {
  await openTool('Protect PDF');

  await expect(dialog()).toContainText('Writes a new file');
  await expect(dialog()).toContainText('cannot recover one for you if it is lost');

  // Nothing to remove from a document that has no security.
  await expect(dialog().getByRole('radio', { name: /Remove security/ })).toBeDisabled();

  // Without an owner password the restrictions are not really restrictions,
  // and the dialog says so rather than implying a lock.
  await expect(dialog()).toContainText('anyone can lift these restrictions');

  await dialog().getByLabel('To open', { exact: true }).fill('one');
  await dialog().getByLabel('Again', { exact: true }).fill('another');
  await expect(dialog()).toContainText('The two open passwords do not match');
  await expect(dialog().getByRole('button', { name: 'Save protected copy' })).toBeDisabled();

  await dialog().getByRole('button', { name: 'Cancel' }).click();
});
