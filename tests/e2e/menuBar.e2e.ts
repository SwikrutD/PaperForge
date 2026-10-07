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
 * The menu bar is shown or hidden from Settings, the choice is kept, and a
 * hidden bar can always be brought back with the mouse. Reading mode says how
 * to leave it, and leaves the saved choice alone.
 */
const mainBundle = path.resolve('.vite', 'build', 'main.js');

let app: ElectronApplication;
let page: Page;
let sandbox = '';

async function launch(): Promise<void> {
  app = await electron.launch({
    executablePath: electronBinary as unknown as string,
    args: [mainBundle, `--user-data-dir=${path.join(sandbox, 'profile')}`],
  });
  page = await app.firstWindow();
  await page.waitForSelector('[data-focus-region="workspace"]');
  const recovery = page.getByRole('dialog').filter({ hasText: 'Recover documents' });
  if ((await recovery.count()) > 0) await recovery.getByRole('button', { name: 'Discard' }).click();
}

async function relaunch(): Promise<void> {
  await app.close();
  await launch();
}

function menuBar(): Locator {
  return page.getByRole('menubar', { name: 'Main menu' });
}

function menuBarSetting(): Locator {
  return page
    .getByRole('dialog', { name: 'Settings' })
    .getByRole('checkbox', { name: 'Show menu bar' });
}

/** Opens Settings from the title bar, which is there whatever the menu bar is doing. */
async function openSettings(): Promise<void> {
  await page.getByRole('banner').getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
}

async function closeSettings(): Promise<void> {
  await page
    .getByRole('dialog', { name: 'Settings' })
    .getByRole('button', { name: 'Close' })
    .last()
    .click();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toHaveCount(0);
}

async function openDocument(): Promise<void> {
  if ((await page.getByRole('tab', { name: /Reading\.pdf/ }).count()) > 0) return;
  const documentPath = path.join(sandbox, 'Reading.pdf');
  await fs.writeFile(
    documentPath,
    buildPdf({ pages: [{ content: 'BT /F1 18 Tf 60 700 Td (Something to read) Tj ET' }] }),
  );
  await page.evaluate(
    (target: string) => window.paperforge.invoke('files:openPaths', { paths: [target] }),
    documentPath,
  );
  await page.getByRole('button', { name: 'Open Reading.pdf' }).click();
  await expect(page.getByLabel('Page 1').getByText('Something to read')).toBeVisible();
}

test.beforeAll(async () => {
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'paperforge-menubar-'));
  await launch();
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

test('the View menu no longer has a Command Bar item', async () => {
  await page.getByRole('menuitem', { name: 'View', exact: true }).click();
  const view = page.getByRole('menu', { name: 'View' });
  await expect(view).toBeVisible();
  await expect(view.getByText(/Command Bar/i)).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'View', exact: true }).click();
});

test('Show menu bar is on in Settings > General to begin with', async () => {
  await openSettings();
  await expect(
    page
      .getByRole('dialog', { name: 'Settings' })
      .getByRole('region', { name: 'General' })
      .getByRole('checkbox', { name: 'Show menu bar' }),
  ).toBeChecked();
  await closeSettings();
  await expect(menuBar()).toBeVisible();
});

test('turning it off hides the menu bar, and it stays hidden after a restart', async () => {
  await openSettings();
  await menuBarSetting().uncheck();
  await expect(menuBar()).toHaveCount(0);
  await closeSettings();

  await relaunch();
  await expect(menuBar()).toHaveCount(0);
  await openSettings();
  await expect(menuBarSetting()).not.toBeChecked();
  await closeSettings();
});

test('while it is hidden, Search commands works by mouse and by Ctrl+K', async () => {
  await expect(menuBar()).toHaveCount(0);
  await page.getByRole('banner').getByRole('button', { name: 'Search commands' }).click();
  await expect(page.getByRole('dialog', { name: /Command palette/i })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: /Command palette/i })).toHaveCount(0);

  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog', { name: /Command palette/i })).toBeVisible();
  await page.keyboard.press('Escape');
});

test('the menu bar comes back with the mouse alone, and stays back', async () => {
  await expect(menuBar()).toHaveCount(0);
  await page.getByRole('banner').getByRole('button', { name: 'Show menu bar' }).click();
  await expect(menuBar()).toBeVisible();
  await expect(page.getByRole('banner').getByRole('button', { name: 'Show menu bar' })).toHaveCount(
    0,
  );

  await relaunch();
  await expect(menuBar()).toBeVisible();
  await openSettings();
  await expect(menuBarSetting()).toBeChecked();
  await closeSettings();
});

test('turning it on in Settings shows the menu bar', async () => {
  await openSettings();
  await menuBarSetting().uncheck();
  await expect(menuBar()).toHaveCount(0);
  await menuBarSetting().check();
  await expect(menuBar()).toBeVisible();
  await closeSettings();
});

test('reading mode says how to leave it, offers an exit at the top, and Esc brings everything back', async () => {
  await openDocument();
  await page.keyboard.press('Control+Shift+R');
  await expect(menuBar()).toHaveCount(0);
  await expect(page.getByText('Reading mode. Press Esc to exit.')).toBeVisible();

  const exit = page.getByRole('button', { name: 'Exit reading mode' });
  await page.mouse.move(600, 300);
  await expect(exit).toHaveCount(0);
  await page.mouse.move(600, 4);
  await expect(exit).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(menuBar()).toBeVisible();
  await expect(page.locator('[data-focus-region="leftRail"]')).toBeVisible();
  await expect(page.locator('[data-focus-region="statusBar"]')).toBeVisible();
});

test('the exit button leaves reading mode too', async () => {
  await openDocument();
  await page.keyboard.press('Control+Shift+R');
  await expect(menuBar()).toHaveCount(0);
  await page.mouse.move(600, 300);
  await page.mouse.move(600, 4);
  await page.getByRole('button', { name: 'Exit reading mode' }).click();
  await expect(menuBar()).toBeVisible();
});

test('reading mode leaves a hidden menu bar hidden, and a shown one shown', async () => {
  await openDocument();
  await openSettings();
  await menuBarSetting().uncheck();
  await closeSettings();

  await page.keyboard.press('Control+Shift+R');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-focus-region="statusBar"]')).toBeVisible();
  await expect(menuBar()).toHaveCount(0);

  await relaunch();
  await expect(menuBar()).toHaveCount(0);
  await page.getByRole('banner').getByRole('button', { name: 'Show menu bar' }).click();
  await expect(menuBar()).toBeVisible();
});
