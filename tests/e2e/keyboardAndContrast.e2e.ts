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
let documentPath = '';

/**
 * Controls a screen reader would announce with no name: buttons, links, form
 * fields and tabs that are on screen, enabled or not, and carry neither text
 * nor a label. Each is described by its tag and classes so a failure says
 * where to look.
 */
async function unnamedControls(): Promise<string[]> {
  return page.evaluate(() => {
    const selector =
      'button, a[href], input:not([type="hidden"]), select, textarea, [role="tab"], [role="menuitem"], [role="option"], [role="checkbox"], [role="switch"]';
    const unnamed: string[] = [];
    for (const element of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (element.closest('[aria-hidden="true"]') !== null) continue;
      const labelledBy = element.getAttribute('aria-labelledby');
      const labelled =
        (element.getAttribute('aria-label') ?? '').trim() !== '' ||
        (labelledBy !== null &&
          labelledBy
            .split(/\s+/)
            .some((id) => (document.getElementById(id)?.textContent ?? '').trim() !== '')) ||
        (element.textContent ?? '').trim() !== '' ||
        (element.getAttribute('title') ?? '').trim() !== '' ||
        ((element as HTMLInputElement).labels?.length ?? 0) > 0 ||
        (element.getAttribute('placeholder') ?? '').trim() !== '';
      if (!labelled) unnamed.push(`${element.tagName.toLowerCase()}.${element.className}`);
    }
    return unnamed;
  });
}

/** The element that has focus, by its accessible name, for following the keyboard. */
async function focusedName(): Promise<string> {
  return page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    if (element === null) return '';
    return (
      element.getAttribute('aria-label') ??
      element.getAttribute('data-focus-region') ??
      element.textContent ??
      ''
    ).trim();
  });
}

test.beforeAll(async () => {
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'paperforge-keyboard-'));
  documentPath = path.join(sandbox, 'Keyboard.pdf');
  await fs.writeFile(documentPath, navigationDocument());

  app = await electron.launch({
    executablePath: electronBinary as unknown as string,
    args: [mainBundle, `--user-data-dir=${path.join(sandbox, 'profile')}`],
  });
  page = await app.firstWindow();
  await page.waitForSelector('[data-focus-region="workspace"]');

  // Put the document on the recent list, then go back to the home screen.
  await page.evaluate(
    (target: string) => window.paperforge.invoke('files:openPaths', { paths: [target] }),
    documentPath,
  );
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

test('every control on the home screen has a name', async () => {
  await page.reload();
  await page.waitForSelector('[data-focus-region="workspace"]');
  for (let guard = 0; guard < 5 && (await page.getByRole('tab').count()) > 0; guard += 1) {
    await page.keyboard.press('Control+w');
    await page.waitForTimeout(150);
  }
  await expect(page.getByRole('heading', { name: 'PaperForge', level: 1 })).toBeVisible();
  expect(await unnamedControls()).toEqual([]);
});

test('a document can be opened and read with the keyboard alone', async () => {
  // Tab from the top of the window until the recent file has focus.
  await page.locator('body').focus();
  let reached = false;
  for (let presses = 0; presses < 60 && !reached; presses += 1) {
    await page.keyboard.press('Tab');
    reached = (await focusedName()) === 'Open Keyboard.pdf';
  }
  expect(reached).toBe(true);

  // Focus is visible where it lands.
  const outline = await page.evaluate(
    () => getComputedStyle(document.activeElement as Element).outlineStyle,
  );
  expect(outline).not.toBe('none');

  await page.keyboard.press('Enter');
  await expect(page.locator('[data-page-number="1"][data-rendered="true"]')).toBeVisible();

  // F6 moves between the major regions, and the workspace takes paging keys.
  const regions = new Set<string>();
  for (let presses = 0; presses < 6; presses += 1) {
    await page.keyboard.press('F6');
    regions.add(
      await page.evaluate(
        () =>
          document.activeElement
            ?.closest('[data-focus-region]')
            ?.getAttribute('data-focus-region') ?? '',
      ),
    );
  }
  expect(regions.size).toBeGreaterThanOrEqual(4);

  // Ctrl+F and the find field, then back out with Escape.
  await page.keyboard.press('Control+f');
  await expect(page.getByRole('searchbox', { name: 'Find in document' })).toBeFocused();
  await page.keyboard.type('about');
  await expect(page.getByText('1 of 2')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('searchbox', { name: 'Find in document' })).toBeHidden();

  // The command palette reaches any command, and gives focus back after.
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
  await page.keyboard.type('Document Properties');
  await page.keyboard.press('Enter');
  const properties = page.getByRole('dialog', { name: 'Document Properties' });
  await expect(properties).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(properties).toBeHidden();
});

test('every control in the document workspace has a name', async () => {
  await expect(page.locator('[data-page-number="1"]')).toBeVisible();
  expect(await unnamedControls()).toEqual([]);

  // Each navigation panel, and each tab of the properties pane.
  for (const panel of ['Page Thumbnails', 'Bookmarks', 'Attachments', 'Layers']) {
    const region = page.getByRole('region', { name: panel });
    if (!(await region.isVisible())) await page.getByRole('button', { name: panel }).click();
    await expect(region).toBeVisible();
    expect(await unnamedControls(), panel).toEqual([]);
  }
  const pane = page.getByRole('region', { name: 'Properties and tools' });
  if (!(await pane.isVisible())) await page.keyboard.press('F4');
  await expect(pane).toBeVisible();
  for (const tab of ['Properties', 'Comments', 'Tools']) {
    await pane.getByRole('tab', { name: tab }).click();
    expect(await unnamedControls(), tab).toEqual([]);
  }
});

test('a high contrast theme keeps state visible and the page untouched', async () => {
  await page.emulateMedia({ forcedColors: 'active' });

  // The open tab is shown with the theme's highlight, not a tint it removed.
  const tabColours = await page.getByRole('tab', { name: /Keyboard\.pdf/ }).evaluate((tab) => {
    const style = getComputedStyle(tab);
    return {
      background: style.backgroundColor,
      adjust: style.getPropertyValue('forced-color-adjust'),
    };
  });
  expect(tabColours.adjust).toBe('none');
  expect(tabColours.background).not.toBe('rgba(0, 0, 0, 0)');

  // The selectable text over a page stays invisible; the theme does not draw it.
  const textColour = await page
    .locator('[data-page-number="1"] span')
    .filter({ hasText: /\S/ })
    .first()
    .evaluate((span) => getComputedStyle(span).color);
  expect(textColour).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);

  await page.emulateMedia({ forcedColors: 'none' });
});
