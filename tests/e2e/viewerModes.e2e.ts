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
import { longDocument, scannedBook } from '../fixtures/large';

const mainBundle = path.resolve('.vite', 'build', 'main.js');

/**
 * How much the window's memory may grow while paging through the whole scan.
 * Paging drops each page it leaves, so what is held should stay where it
 * started; the allowance is for the browser's caches settling.
 */
const MAX_MEMORY_GROWTH_MB = 300;

let app: ElectronApplication;
let page: Page;
let sandbox = '';
let longPath = '';
let scanPath = '';

/** Megabytes the window's renderer process holds, as Windows counts them. */
async function rendererMemoryMb(): Promise<number> {
  const metrics = await app.evaluate(({ app: electronApp, BrowserWindow }) => {
    const [window] = BrowserWindow.getAllWindows();
    const rendererPid = window?.webContents.getOSProcessId();
    const entry = electronApp.getAppMetrics().find((metric) => metric.pid === rendererPid);
    return entry?.memory.workingSetSize ?? 0;
  });
  return Math.round(metrics / 1024);
}

function report(line: string): void {
  process.stdout.write(`${line}\n`);
}

function pageBox(): Locator {
  return page.getByRole('textbox', { name: /^Page number/ });
}

function pagesRegion(): Locator {
  return page.getByRole('region', { name: 'Document pages' });
}

function mountedPages(): Locator {
  return page.locator('[data-page-number]');
}

function rendered(pageNumber: number): Locator {
  return page.locator(`[data-page-number="${pageNumber}"][data-rendered="true"]`);
}

async function goToPage(pageNumber: number): Promise<void> {
  await pageBox().fill(String(pageNumber));
  await pageBox().press('Enter');
}

/** Presses a toolbar toggle from the keyboard, the way a keyboard user would. */
async function pressToggle(name: string): Promise<Locator> {
  const button = page.getByRole('button', { name, exact: true });
  await button.focus();
  await page.keyboard.press('Enter');
  return button;
}

async function openOnly(filePath: string): Promise<void> {
  for (let guard = 0; guard < 10 && (await page.getByRole('tab').count()) > 0; guard += 1) {
    await page.keyboard.press('Control+w');
    await page.waitForTimeout(150);
  }
  await page.evaluate(
    (target: string) => window.paperforge.invoke('files:openPaths', { paths: [target] }),
    filePath,
  );
  await page.getByRole('button', { name: `Open ${path.basename(filePath)}` }).click();
  await expect(rendered(1)).toBeVisible();
}

/**
 * Pages through a scanned book, waiting for each page to be drawn, and
 * reports the window's memory before, at its peak and after.
 */
async function pageThroughScan(
  label: string,
  turn: (target: number) => Promise<void>,
  targets: readonly number[],
): Promise<{ before: number; peak: number; after: number }> {
  const before = await rendererMemoryMb();
  let peak = before;
  for (const [index, target] of targets.entries()) {
    await turn(target);
    await expect(rendered(target)).toBeVisible();
    if (index % 5 === 0) peak = Math.max(peak, await rendererMemoryMb());
  }
  const after = await rendererMemoryMb();
  peak = Math.max(peak, after);
  report(`${label}: renderer ${before} MB before, ${peak} MB peak, ${after} MB after`);
  return { before, peak, after };
}

test.beforeAll(async () => {
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'paperforge-modes-'));
  longPath = path.join(sandbox, 'Long book.pdf');
  scanPath = path.join(sandbox, 'Scanned book.pdf');
  await fs.writeFile(longPath, await longDocument(1000));
  await fs.writeFile(scanPath, await scannedBook(120));

  app = await electron.launch({
    executablePath: electronBinary as unknown as string,
    args: [mainBundle, `--user-data-dir=${path.join(sandbox, 'profile')}`],
  });
  page = await app.firstWindow();
  await page.waitForSelector('[data-focus-region="workspace"]');
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

test('single page view shows one page and turns pages from the keyboard', async () => {
  await openOnly(longPath);
  const toggle = await pressToggle('Single Page View');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(mountedPages()).toHaveCount(1);
  await expect(page.getByText('Single page', { exact: false }).first()).toBeVisible();

  // Page Down scrolls to the foot of a tall page, then turns it.
  await pagesRegion().focus();
  for (let presses = 0; presses < 6 && !(await rendered(2).isVisible()); presses += 1) {
    await page.keyboard.press('PageDown');
    // Page Down glides; the page turns from where the glide ends.
    await page.waitForTimeout(300);
  }
  await expect(rendered(2)).toBeVisible();
  await expect(mountedPages()).toHaveCount(1);
  await expect(pageBox()).toHaveValue('2');

  // End and Home go to the ends of the document; the side arrows turn pages.
  await page.keyboard.press('End');
  await expect(rendered(1000)).toBeVisible();
  await page.keyboard.press('Home');
  await expect(rendered(1)).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(rendered(2)).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(rendered(1)).toBeVisible();

  // The page box goes straight to a page, and only that page is mounted.
  await goToPage(500);
  await expect(rendered(500)).toBeVisible();
  await expect(mountedPages()).toHaveCount(1);
});

test('the wheel turns pages in single page view once a page is scrolled through', async () => {
  // At fit page the whole page is on screen, so wheeling on turns it.
  await page.keyboard.press('Control+0');
  const area = await pagesRegion().boundingBox();
  if (area === null) throw new Error('The pages are not on screen.');
  await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2);
  for (let notches = 0; notches < 4 && !(await rendered(501).isVisible()); notches += 1) {
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(80);
  }
  await expect(rendered(501)).toBeVisible();
  await page.waitForTimeout(500);
  for (let notches = 0; notches < 4 && !(await rendered(500).isVisible()); notches += 1) {
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(80);
  }
  await expect(rendered(500)).toBeVisible();
});

test('a search match on another page turns single page view to it', async () => {
  await page.keyboard.press('Control+f');
  await page.keyboard.type('Long document page 742');
  await expect(rendered(742)).toBeVisible();
  await expect(mountedPages()).toHaveCount(1);
  await page.keyboard.press('Escape');
  await goToPage(500);
  await expect(rendered(500)).toBeVisible();
});

test('turning single page view off returns to continuous scrolling at the same page', async () => {
  const toggle = await pressToggle('Single Page View');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(rendered(500)).toBeVisible();
  await expect(pageBox()).toHaveValue('500');
  await expect.poll(async () => mountedPages().count()).toBeGreaterThan(1);
  await page.keyboard.press('Control+2');
});

test('paging through a long scan in single page view keeps memory flat', async () => {
  await openOnly(scanPath);
  await pressToggle('Single Page View');
  await expect(mountedPages()).toHaveCount(1);
  await pagesRegion().focus();

  const targets = Array.from({ length: 119 }, (_, index) => index + 2);
  const memory = await pageThroughScan(
    '120-page scan, single page view',
    async () => {
      await page.keyboard.press('ArrowRight');
    },
    targets,
  );
  await expect(mountedPages()).toHaveCount(1);
  expect(memory.peak - memory.before).toBeLessThan(MAX_MEMORY_GROWTH_MB);
  await pressToggle('Single Page View');
});

test('two-page view sets pages side by side and steps a pair at a time', async () => {
  await openOnly(longPath);
  const toggle = await pressToggle('Two-Page View');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(rendered(1)).toBeVisible();
  await expect(rendered(2)).toBeVisible();
  await expect(page.getByText(/Two pages/).first()).toBeVisible();

  // Page one on the left, page two on the right, level with each other.
  const left = await rendered(1).boundingBox();
  const right = await rendered(2).boundingBox();
  if (left === null || right === null) throw new Error('The pair is not on screen.');
  expect(Math.round(left.y)).toBe(Math.round(right.y));
  expect(left.x + left.width).toBeLessThanOrEqual(right.x);

  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(pageBox()).toHaveValue('3');
  await expect(rendered(3)).toBeVisible();
  await expect(rendered(4)).toBeVisible();

  await goToPage(700);
  await expect(rendered(699)).toBeVisible();
  await expect(rendered(700)).toBeVisible();
  expect(await mountedPages().count()).toBeLessThanOrEqual(12);
});

test('two-page view with single page view shows one pair at a time', async () => {
  await pressToggle('Single Page View');
  await expect(mountedPages()).toHaveCount(2);
  await expect(rendered(699)).toBeVisible();
  await pagesRegion().focus();
  await page.keyboard.press('ArrowRight');
  await expect(rendered(701)).toBeVisible();
  await expect(rendered(702)).toBeVisible();
  await expect(mountedPages()).toHaveCount(2);
  await page.keyboard.press('End');
  await expect(rendered(999)).toBeVisible();
  await expect(rendered(1000)).toBeVisible();
  await pressToggle('Single Page View');
  await pressToggle('Two-Page View');
  await expect(rendered(999)).toBeVisible();
});

test('paging through a long scan two pages at a time keeps memory flat', async () => {
  await openOnly(scanPath);
  await pressToggle('Two-Page View');
  await pressToggle('Single Page View');
  await expect(mountedPages()).toHaveCount(2);
  await pagesRegion().focus();

  const targets = Array.from({ length: 59 }, (_, index) => index * 2 + 3);
  const memory = await pageThroughScan(
    '120-page scan, two-page single page view',
    async () => {
      await page.keyboard.press('ArrowRight');
    },
    targets,
  );
  await expect(mountedPages()).toHaveCount(2);
  expect(memory.peak - memory.before).toBeLessThan(MAX_MEMORY_GROWTH_MB);

  // And scrolling the continuous spread from end to end.
  await pressToggle('Single Page View');
  const scrolled = await pageThroughScan(
    '120-page scan, continuous two-page view',
    goToPage,
    Array.from({ length: 30 }, (_, index) => 120 - index * 4 - 1),
  );
  expect(await mountedPages().count()).toBeLessThanOrEqual(12);
  expect(scrolled.peak - scrolled.before).toBeLessThan(MAX_MEMORY_GROWTH_MB);
  await pressToggle('Two-Page View');
});

test('a cover page stands alone and the pages after it face each other', async () => {
  await openOnly(longPath);
  const cover = await pressToggle('Show Cover Page');
  await expect(cover).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Two-Page View', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByText(/Two pages, cover/).first()).toBeVisible();

  // The cover sits to the right of the spine; pages two and three share a row below it.
  const region = await pagesRegion().boundingBox();
  const first = await rendered(1).boundingBox();
  await expect(rendered(2)).toBeVisible();
  const second = await rendered(2).boundingBox();
  const third = await rendered(3).boundingBox();
  if (region === null || first === null || second === null || third === null) {
    throw new Error('The pages are not on screen.');
  }
  expect(first.x).toBeGreaterThan(region.x + region.width / 2 - 20);
  expect(second.y).toBeGreaterThan(first.y + first.height);
  expect(Math.round(second.y)).toBe(Math.round(third.y));
  expect(second.x + second.width).toBeLessThanOrEqual(third.x);

  // Next page goes from the cover to the first pair, then on a pair at a time.
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(pageBox()).toHaveValue('2');
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(pageBox()).toHaveValue('4');

  // In single page view the pairs come one at a time, with the cover alone.
  await pressToggle('Single Page View');
  await expect(mountedPages()).toHaveCount(2);
  await pagesRegion().focus();
  await page.keyboard.press('Home');
  await expect(rendered(1)).toBeVisible();
  await expect(mountedPages()).toHaveCount(1);
  await page.keyboard.press('ArrowRight');
  await expect(rendered(2)).toBeVisible();
  await expect(rendered(3)).toBeVisible();
  await expect(mountedPages()).toHaveCount(2);
  await page.keyboard.press('End');
  // A thousand pages after a cover end on a lone even page.
  await expect(rendered(1000)).toBeVisible();
  await expect(mountedPages()).toHaveCount(1);
  await pressToggle('Single Page View');
  await pressToggle('Show Cover Page');
  await pressToggle('Two-Page View');
});

test('paging through a long scan with a cover page keeps memory flat', async () => {
  await openOnly(scanPath);
  await pressToggle('Show Cover Page');
  await pressToggle('Single Page View');
  await pagesRegion().focus();
  const targets = Array.from({ length: 60 }, (_, index) => index * 2 + 2);
  const memory = await pageThroughScan(
    '120-page scan, cover page single page view',
    async () => {
      await page.keyboard.press('ArrowRight');
    },
    targets,
  );
  expect(await mountedPages().count()).toBeLessThanOrEqual(2);
  expect(memory.peak - memory.before).toBeLessThan(MAX_MEMORY_GROWTH_MB);
  await pressToggle('Single Page View');
  await pressToggle('Show Cover Page');
  await pressToggle('Two-Page View');
});

/** The pages' scroll position, as the scroller reports it. */
async function scrollPosition(): Promise<{ left: number; top: number }> {
  return pagesRegion().evaluate((element) => ({
    left: element.scrollLeft,
    top: element.scrollTop,
  }));
}

/** Drags across the middle of the pages by the given distance. */
async function dragPages(dx: number, dy: number): Promise<void> {
  const area = await pagesRegion().boundingBox();
  if (area === null) throw new Error('The pages are not on screen.');
  const x = area.x + area.width / 2;
  const y = area.y + area.height * 0.75;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  await page.mouse.up();
}

test('the hand tool drags the pages instead of selecting text', async () => {
  await openOnly(longPath);
  await page.keyboard.press('Control+Shift+H');
  const hand = page.getByRole('button', { name: 'Hand Tool', exact: true });
  await expect(hand).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Select Tool', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(pagesRegion()).toHaveAttribute('data-tool', 'hand');

  const before = await scrollPosition();
  await dragPages(0, -400);
  const after = await scrollPosition();
  expect(after.top - before.top).toBeGreaterThan(350);
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');
  // The pages keep the keyboard, so the arrow keys move them as well.
  await expect(pagesRegion()).toBeFocused();

  // Dragging down brings the reader back.
  await dragPages(0, 400);
  expect((await scrollPosition()).top).toBeLessThan(after.top - 350);

  // Zoomed in, the hand moves the page sideways too.
  for (let step = 0; step < 4; step += 1) await page.keyboard.press('Control+=');
  const wide = await scrollPosition();
  await dragPages(-300, 0);
  expect((await scrollPosition()).left - wide.left).toBeGreaterThan(250);
  await page.keyboard.press('Control+2');
});

test('the hand tool gives way to the comment tools and comes back after', async () => {
  await page.keyboard.press('Control+m');
  await page.getByRole('button', { name: 'Highlight', exact: true }).click();
  await expect(pagesRegion()).toHaveAttribute('data-tool', 'select');
  await expect(page.getByRole('button', { name: 'Hand Tool', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+m');
  await expect(pagesRegion()).toHaveAttribute('data-tool', 'hand');
});

test('dragging through a long scan with the hand tool keeps memory flat', async () => {
  await openOnly(scanPath);
  await expect(pagesRegion()).toHaveAttribute('data-tool', 'hand');
  const before = await rendererMemoryMb();
  let peak = before;
  for (let drag = 0; drag < 60; drag += 1) {
    await dragPages(0, -1200);
    if (drag % 10 === 0) peak = Math.max(peak, await rendererMemoryMb());
  }
  const reached = Number(await pageBox().inputValue());
  await expect(rendered(reached)).toBeVisible();
  const after = await rendererMemoryMb();
  peak = Math.max(peak, after);
  report(
    `120-page scan, hand tool to page ${reached}: renderer ${before} MB before, ${peak} MB peak, ${after} MB after`,
  );
  expect(reached).toBeGreaterThan(20);
  expect(await mountedPages().count()).toBeLessThanOrEqual(12);
  expect(peak - before).toBeLessThan(MAX_MEMORY_GROWTH_MB);
  await page.keyboard.press('Control+Shift+H');
  await expect(pagesRegion()).toHaveAttribute('data-tool', 'select');
});
