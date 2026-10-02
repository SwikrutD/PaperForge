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

/**
 * Compare Files in the real application: two versions of a contract, the
 * differences between them found, listed and shown on both pages — with the
 * pixels compared in the comparison worker the packaged build ships.
 */

const mainBundle = path.resolve('.vite', 'build', 'main.js');

let app: ElectronApplication;
let page: Page;
let sandbox = '';

function workspace(): Locator {
  return page.locator('[data-compare-workspace]');
}

function differences(): Locator {
  return page.getByRole('list', { name: 'Differences found' });
}

async function open(filePath: string): Promise<void> {
  await app.evaluate(({ dialog }, target: string) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [target] });
  }, filePath);
  await page.keyboard.press('Control+o');
  await expect(page.getByRole('tab', { name: path.basename(filePath) })).toBeVisible();
}

test.beforeAll(async () => {
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'paperforge-compare-'));
  app = await electron.launch({
    executablePath: electronBinary as unknown as string,
    args: [mainBundle, `--user-data-dir=${path.join(sandbox, 'profile')}`],
  });
  page = await app.firstWindow();
  await page.waitForSelector('[data-focus-region="workspace"]');

  const recovery = page.getByRole('dialog').filter({ hasText: 'Recover documents' });
  if ((await recovery.count()) > 0) await recovery.getByRole('button', { name: 'Discard' }).click();

  await fs.writeFile(
    path.join(sandbox, 'Contract v1.pdf'),
    buildPdf({
      pages: [
        { text: 'Payment is due within 30 days of delivery' },
        { text: 'This closing page does not change' },
      ],
    }),
  );
  await fs.writeFile(
    path.join(sandbox, 'Contract v2.pdf'),
    buildPdf({
      pages: [
        {
          text: 'Payment is due within 45 days of the delivery',
          image: { pixels: { width: 8, height: 8 }, x: 300, y: 200, width: 120, height: 120 },
        },
        { text: 'This closing page does not change' },
        { text: 'An appendix nobody had before' },
      ],
    }),
  );
  await open(path.join(sandbox, 'Contract v1.pdf'));
  await open(path.join(sandbox, 'Contract v2.pdf'));
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

test('finds text, picture and page differences between two versions', async () => {
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder('Search commands').fill('Compare Files');
  await page
    .getByRole('option', { name: /^Compare Files/ })
    .first()
    .click();
  await expect(workspace()).toBeVisible();

  await page.getByLabel('Original', { exact: true }).selectOption({ label: 'Contract v1.pdf' });
  await page.getByLabel('Revised', { exact: true }).selectOption({ label: 'Contract v2.pdf' });
  await page.getByRole('button', { name: 'Compare', exact: true }).click();

  await expect(page.getByRole('status').filter({ hasText: /differences? on/ })).toBeVisible({
    timeout: 20_000,
  });
  await expect(differences()).toContainText('“30” → “45”');
  await expect(differences()).toContainText('Added “the”');
  await expect(differences()).toContainText('Picture, drawing or layout changed');
  await expect(differences()).toContainText('Page 3 is only in the revised document');
  // The page that did not change contributes nothing.
  await expect(differences()).not.toContainText('closing');
});

test('choosing a difference shows it on both pages', async () => {
  await differences()
    .getByRole('button', { name: /“30” → “45”/ })
    .click();
  await expect(page.getByText('Page pair 1 of 3')).toBeVisible();
  const original = page.locator('[data-compare-page="original"]');
  const revised = page.locator('[data-compare-page="revised"]');
  await expect(original.locator('[data-difference="textChanged"]')).toHaveCount(1);
  await expect(revised.locator('[data-difference="textChanged"]')).toHaveCount(1);
  await expect(revised.locator('[data-difference="visual"]')).toHaveCount(1);

  // Next difference walks the list in order, across page pairs.
  for (let step = 0; step < 3; step += 1) {
    await page.getByRole('button', { name: 'Next difference' }).click();
  }
  await expect(page.getByText('Page pair 3 of 3')).toBeVisible();
  await expect(
    page.getByText('The revised document has a page here that the original does not.'),
  ).toBeVisible();
});

test('the filters and the overlay', async () => {
  await page.getByRole('checkbox', { name: 'Text', exact: true }).uncheck();
  await expect(differences()).not.toContainText('“30” → “45”');
  await expect(differences()).toContainText('Picture, drawing or layout changed');
  await page.getByRole('checkbox', { name: 'Text', exact: true }).check();

  await page.getByRole('button', { name: 'Previous page pair' }).click();
  await page.getByRole('button', { name: 'Previous page pair' }).click();
  await page.getByRole('button', { name: 'Overlay' }).click();
  await expect(page.locator('[data-compare-overlay] canvas')).toBeVisible({ timeout: 10_000 });

  await page.getByRole('button', { name: 'Close Compare' }).click();
  await expect(workspace()).toHaveCount(0);
  await expect(page.getByText('Payment is due within 45 days of the delivery')).toBeVisible();
});
