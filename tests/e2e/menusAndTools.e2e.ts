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
 * A long menu fits the window and scrolls, by wheel and by keyboard; and the
 * comment tools can be picked from the Tools pane while editing.
 */
const mainBundle = path.resolve('.vite', 'build', 'main.js');

let app: ElectronApplication;
let page: Page;
let sandbox = '';

function toolsMenu(): Locator {
  return page.getByRole('menu', { name: 'Tools' });
}

async function openToolsMenu(): Promise<void> {
  if ((await toolsMenu().count()) === 0) {
    await page.getByRole('menuitem', { name: 'Tools', exact: true }).click();
  }
  await expect(toolsMenu()).toBeVisible();
}

async function closeMenus(): Promise<void> {
  // Clicking the open menu's trigger closes it, however it was opened.
  if ((await toolsMenu().count()) > 0) {
    await page.getByRole('menuitem', { name: 'Tools', exact: true }).click();
  }
  await expect(toolsMenu()).toHaveCount(0);
}

/** The focused element's label, and whether the open menu shows all of it. */
function focusedInView(): Promise<{ label: string; visible: boolean }> {
  return page.evaluate(() => {
    const focused = document.activeElement as HTMLElement | null;
    const menu = focused?.closest('[role="menu"]');
    if (focused === null || menu === null || menu === undefined) {
      return { label: focused?.textContent ?? '', visible: false };
    }
    const item = focused.getBoundingClientRect();
    const box = menu.getBoundingClientRect();
    return {
      label: focused.textContent ?? '',
      visible: item.top >= box.top - 1 && item.bottom <= box.bottom + 1,
    };
  });
}

/** Labels of the Tools menu's items that can be used right now. */
function enabledItems(): Promise<string[]> {
  return toolsMenu().evaluate((menu) =>
    [...menu.querySelectorAll<HTMLButtonElement>('button')]
      .filter((button) => !button.disabled)
      .map((button) => button.textContent ?? ''),
  );
}

/** Opens the test document, unless it is open already. */
async function openDocument(): Promise<void> {
  if ((await page.getByRole('tab', { name: 'Menus.pdf' }).count()) > 0) return;
  const documentPath = path.join(sandbox, 'Menus.pdf');
  await fs.writeFile(
    documentPath,
    buildPdf({ pages: [{ content: 'BT /F1 18 Tf 60 700 Td (Words to mark up) Tj ET' }] }),
  );
  await page.evaluate(
    (target: string) => window.paperforge.invoke('files:openPaths', { paths: [target] }),
    documentPath,
  );
  await page.getByRole('button', { name: 'Open Menus.pdf' }).click();
  await expect(page.getByLabel('Page 1').getByText('Words to mark up')).toBeVisible();
}

/** Turns the content editor on, from whatever mode the page is in. */
async function startEditing(): Promise<void> {
  await openDocument();
  const editing = page.getByRole('toolbar', { name: 'Editing' });
  if ((await editing.count()) === 0) await page.keyboard.press('Control+e');
  await expect(editing).toBeVisible();
}

test.beforeAll(async () => {
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'paperforge-menus-'));
  app = await electron.launch({
    executablePath: electronBinary as unknown as string,
    args: [mainBundle, `--user-data-dir=${path.join(sandbox, 'profile')}`],
  });
  page = await app.firstWindow();
  await page.waitForSelector('[data-focus-region="workspace"]');
  const recovery = page.getByRole('dialog').filter({ hasText: 'Recover documents' });
  if ((await recovery.count()) > 0) await recovery.getByRole('button', { name: 'Discard' }).click();
  // A short window, so the Tools menu is longer than the room below it.
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window?.unmaximize();
    window?.setSize(1100, 560);
  });
  await page.waitForTimeout(300);
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

test('the arrow keys move past items that cannot be used, instead of stopping', async () => {
  // With no document open most tools are unavailable.
  await page.getByRole('menuitem', { name: 'Tools', exact: true }).focus();
  await page.keyboard.press('ArrowDown');
  await expect(toolsMenu()).toBeVisible();

  const enabled = await enabledItems();
  expect(enabled.length).toBeGreaterThan(1);
  const seen: string[] = [];
  for (let step = 0; step < enabled.length; step += 1) {
    seen.push((await focusedInView()).label);
    await page.keyboard.press('ArrowDown');
  }
  expect(seen).toEqual(enabled);
  await closeMenus();
});

test('the Tools menu stays inside the window and scrolls with the wheel', async () => {
  await openDocument();
  await openToolsMenu();
  const geometry = await toolsMenu().evaluate((menu) => ({
    bottom: menu.getBoundingClientRect().bottom,
    windowHeight: window.innerHeight,
    overflows: menu.scrollHeight > menu.clientHeight,
  }));
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.windowHeight);
  expect(geometry.overflows).toBe(true);

  const box = await toolsMenu().boundingBox();
  if (box === null) throw new Error('the menu is not on screen');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 400);
  await expect.poll(() => toolsMenu().evaluate((menu) => menu.scrollTop)).toBeGreaterThan(0);
  await closeMenus();
});

test('the keyboard reaches every item, and the menu scrolls to show it', async () => {
  await openDocument();
  await page.getByRole('menuitem', { name: 'Tools', exact: true }).focus();
  await page.keyboard.press('ArrowDown');
  await expect(toolsMenu()).toBeVisible();
  const enabled = await enabledItems();

  await page.keyboard.press('End');
  expect(await focusedInView()).toEqual({ label: enabled[enabled.length - 1], visible: true });

  await page.keyboard.press('Home');
  expect(await focusedInView()).toEqual({ label: enabled[0], visible: true });
  expect(await toolsMenu().evaluate((menu) => menu.scrollTop)).toBe(0);

  // Up from the first item goes round to the last.
  await page.keyboard.press('ArrowUp');
  expect(await focusedInView()).toEqual({ label: enabled[enabled.length - 1], visible: true });
  await closeMenus();
});

test('in Edit PDF mode the Tools pane offers the comment tools', async () => {
  await startEditing();

  const panel = page.getByRole('region', { name: 'Properties and tools' });
  await panel.getByRole('tab', { name: 'Tools' }).click();
  for (const name of ['Highlight', 'Underline', 'Strikethrough', 'Sticky note', 'Draw']) {
    await expect(panel.getByRole('button', { name, exact: true })).toBeVisible();
  }
});

test('choosing one there leaves editing and starts commenting with it', async () => {
  await startEditing();
  const panel = page.getByRole('region', { name: 'Properties and tools' });
  await panel.getByRole('tab', { name: 'Tools' }).click();
  await panel.getByRole('button', { name: 'Highlight', exact: true }).click();

  await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeHidden();
  const comments = page.getByRole('toolbar', { name: 'Comment tools' });
  await expect(comments.getByRole('button', { name: 'Highlight' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('Highlight from the Tools menu in Edit PDF mode works the same way', async () => {
  await startEditing();

  await openToolsMenu();
  await toolsMenu()
    .getByRole('menuitemcheckbox', { name: /Highlight Text/ })
    .click();

  await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeHidden();
  const comments = page.getByRole('toolbar', { name: 'Comment tools' });
  await expect(comments.getByRole('button', { name: 'Highlight' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});
