import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import electronBinary from 'electron';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { navigationDocument } from '../fixtures/pdf';

const mainBundle = path.resolve('.vite', 'build', 'main.js');

let app: ElectronApplication;
let page: Page;
let sandbox = '';

/** Opens a file through the recent list, the way the viewer tests do. */
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

function pageBox(): ReturnType<Page['getByRole']> {
  return page.getByRole('textbox', { name: 'Page number or label' });
}

async function goToLabel(label: string): Promise<void> {
  await pageBox().fill(label);
  await pageBox().press('Enter');
}

/**
 * Shows one navigation panel. The rail collapses the panel it already shows,
 * so the button is only pressed when the panel is not on screen.
 */
async function showPanel(name: string): Promise<void> {
  const region = page.getByRole('region', { name });
  if (!(await region.isVisible())) await page.getByRole('button', { name }).click();
  await expect(region).toBeVisible();
}

/** How much ink one page has on it, which is how layer visibility is checked. */
async function inkOnPage(pageNumber: number): Promise<number> {
  return page.locator(`[data-page-number="${pageNumber}"] canvas`).evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const context = canvas.getContext('2d');
    if (context === null) return -1;
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let dark = 0;
    for (let index = 0; index < data.length; index += 4) {
      if ((data[index] ?? 255) < 200) dark += 1;
    }
    return dark;
  });
}

test.beforeAll(async () => {
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'paperforge-navigation-'));
  app = await electron.launch({
    executablePath: electronBinary as unknown as string,
    args: [mainBundle, `--user-data-dir=${path.join(sandbox, 'profile')}`],
  });
  page = await app.firstWindow();
  await page.waitForSelector('[data-focus-region="workspace"]');

  const filePath = path.join(sandbox, 'Navigation.pdf');
  await fs.writeFile(filePath, navigationDocument());
  await open(filePath, 'Navigation.pdf');
  await expect(page.getByText('Preface about forging paper')).toBeVisible();
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

test('shows the label the document prints on the page', async () => {
  // The first two pages are roman-numbered front matter.
  await expect(pageBox()).toHaveValue('i');
  await expect(page.getByText('(1 of 5)')).toBeVisible();

  // "1" is the third page's label, not its number.
  await goToLabel('1');
  await expect(page.getByText('(3 of 5)')).toBeVisible();
  await expect(page.getByText('Findings about the invoice')).toBeVisible();
});

test('goes to a page from its thumbnail', async () => {
  await showPanel('Page Thumbnails');
  const panel = page.getByRole('region', { name: 'Page Thumbnails' });
  await expect(panel.locator('li')).toHaveCount(5);

  await panel.locator('li').nth(4).getByRole('button').click();
  await expect(page.getByText('(5 of 5)')).toBeVisible();
});

test('navigates by the outline, including a nested entry', async () => {
  await showPanel('Bookmarks');
  const panel = page.getByRole('region', { name: 'Bookmarks' });

  await expect(panel.getByRole('button', { name: /Front matter/ })).toBeVisible();
  await panel.getByRole('button', { name: /^Report/ }).click();
  await expect(page.getByText('(3 of 5)')).toBeVisible();

  // The children of an expanded entry are listed under it.
  await expect(panel.getByRole('button', { name: /Findings/ })).toBeVisible();
  await panel.getByRole('button', { name: /Appendix/ }).click();
  await expect(page.getByText('(5 of 5)')).toBeVisible();
});

test('lists embedded files without offering to open them', async () => {
  await showPanel('Attachments');
  const panel = page.getByRole('region', { name: 'Attachments' });

  await expect(panel.getByText('notes.txt')).toBeVisible();
  await expect(panel.getByText('Reviewer notes')).toBeVisible();
  await expect(panel.getByText('installer.exe')).toBeVisible();

  // The executable is called out, and no row is something you can activate:
  // the only thing offered is writing the bytes somewhere, never opening them.
  await expect(panel.getByText('This kind of file can run code.').first()).toBeAttached();
  await expect(panel.getByRole('button', { name: 'notes.txt', exact: true })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'installer.exe', exact: true })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Save installer.exe' })).toBeAttached();
  await expect(panel).toContainText('never opens one');
});

test('hides and restores an optional content group', async () => {
  // Label "2" is the fourth page, which is the layered one.
  await goToLabel('2');
  await expect(page.getByText('Layered notice')).toBeVisible();

  await showPanel('Layers');
  const toggle = page
    .getByRole('region', { name: 'Layers' })
    .getByRole('checkbox', { name: 'Watermark layer' });
  await expect(toggle).toBeChecked();

  expect(await inkOnPage(4)).toBeGreaterThan(0);

  // The switch is a styled checkbox, so the label is what a reader clicks.
  await page.getByRole('region', { name: 'Layers' }).getByText('Watermark layer').click();
  await expect(toggle).not.toBeChecked();
  await expect.poll(async () => inkOnPage(4)).toBe(0);

  await page.getByRole('region', { name: 'Layers' }).getByText('Watermark layer').click();
  await expect(toggle).toBeChecked();
  await expect.poll(async () => inkOnPage(4)).toBeGreaterThan(0);
});

test('finds text, counts the matches, draws them and steps through them', async () => {
  await page.keyboard.press('Control+f');
  const field = page.getByRole('searchbox', { name: 'Find in document' });
  await expect(field).toBeFocused();

  // "about" appears on the first page and the third.
  await field.fill('about');
  await expect(page.getByText('1 of 2')).toBeVisible();
  await expect(page.locator('[data-search-highlight]').first()).toBeAttached();
  await expect(page.locator('[data-search-highlight="current"]')).toHaveCount(1);

  await page.getByRole('button', { name: 'Next match' }).click();
  await expect(page.getByText('2 of 2')).toBeVisible();

  await page.getByRole('button', { name: 'Previous match' }).click();
  await expect(page.getByText('1 of 2')).toBeVisible();
});

test('honours match case and whole words', async () => {
  const field = page.getByRole('searchbox', { name: 'Find in document' });

  await field.fill('Contents');
  await expect(page.getByText('1 of 1')).toBeVisible();

  await page.getByRole('button', { name: 'Match case' }).click();
  await field.fill('contents');
  await expect(page.getByText('No matches').first()).toBeVisible();
  await page.getByRole('button', { name: 'Match case' }).click();

  // "pape" is inside "paper", so whole words turns the match off.
  await field.fill('pape');
  await expect(page.getByText('1 of 1')).toBeVisible();
  await page.getByRole('button', { name: 'Whole words only' }).click();
  await expect(page.getByText('No matches').first()).toBeVisible();
  await page.getByRole('button', { name: 'Whole words only' }).click();
});

test('searches only the pages it is asked to', async () => {
  await page.getByRole('button', { name: 'Search options' }).click();
  const range = page.getByLabel(/Pages to search/);

  await page.getByRole('searchbox', { name: 'Find in document' }).fill('invoice');
  await expect(page.getByText('1 of 1')).toBeVisible();

  await range.fill('1-2');
  await expect(page.getByText('No matches').first()).toBeVisible();

  await range.fill('99');
  await expect(page.getByRole('alert')).toHaveText('This document has pages 1 to 5.');
  await range.fill('');
});

test('says when the pages carry no text at all', async () => {
  await page.getByLabel(/Pages to search/).fill('5');
  await page.getByRole('searchbox', { name: 'Find in document' }).fill('anything');

  await expect(
    page.getByText(
      'These pages carry no text, so there is nothing to search. They are most likely scanned images.',
    ),
  ).toBeVisible();

  await page.getByLabel(/Pages to search/).fill('');
  await page.getByRole('button', { name: 'Close find' }).click();
  await expect(page.getByRole('searchbox', { name: 'Find in document' })).toBeHidden();
});

test('reading mode leaves only the document, and Escape brings the shell back', async () => {
  await page.keyboard.press('Control+Shift+R');

  await expect(page.getByRole('menubar', { name: 'Main menu' })).toBeHidden();
  await expect(page.getByRole('region', { name: 'Layers' })).toBeHidden();
  await expect(page.locator('[data-page-number]').first()).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByRole('menubar', { name: 'Main menu' })).toBeVisible();
});
