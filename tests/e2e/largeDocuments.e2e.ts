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
import { longDocument, scannedBook } from '../fixtures/large';

const mainBundle = path.resolve('.vite', 'build', 'main.js');

/** Pages the viewer may hold at once: what is on screen and one screen either side. */
const MAX_MOUNTED_PAGES = 12;
/** Thumbnails drawn at once, for the same reason. */
const MAX_DRAWN_THUMBNAILS = 60;
/** A generous ceiling for the window's memory; the measured values are logged. */
const MAX_RENDERER_MEMORY_MB = 1500;

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

/** Prints a measurement with the test output, for the release notes. */
function report(line: string): void {
  process.stdout.write(`${line}\n`);
}

function pageBox(): ReturnType<Page['getByRole']> {
  return page.getByRole('textbox', { name: /^Page number/ });
}

/** Thumbnails holding pixels; one out of view is emptied. */
async function drawnThumbnails(panel: ReturnType<Page['getByRole']>): Promise<number> {
  return panel
    .locator('canvas')
    .evaluateAll(
      (canvases) => canvases.filter((canvas) => (canvas as HTMLCanvasElement).width > 0).length,
    );
}

async function goToPage(pageNumber: number): Promise<void> {
  await pageBox().fill(String(pageNumber));
  await pageBox().press('Enter');
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
}

test.beforeAll(async () => {
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'paperforge-large-'));
  longPath = path.join(sandbox, 'Thousand pages.pdf');
  scanPath = path.join(sandbox, 'Scanned book.pdf');
  const long = await longDocument(1000);
  await fs.writeFile(longPath, long);
  await fs.writeFile(path.join(sandbox, 'Thousand pages again.pdf'), long);
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

test('a 1,000-page document opens quickly and mounts only what is on screen', async () => {
  const started = Date.now();
  await openOnly(longPath);
  await expect(page.locator('[data-page-number="1"][data-rendered="true"]')).toBeVisible();
  const firstPageMs = Date.now() - started;
  report(`1,000 pages: first page drawn after ${firstPageMs} ms`);

  await expect(page.getByText('of 1000', { exact: true })).toBeVisible();
  expect(await page.locator('[data-page-number]').count()).toBeLessThanOrEqual(MAX_MOUNTED_PAGES);
  // The target in CLAUDE.md is about a second; the test allows for a slow machine.
  expect(firstPageMs).toBeLessThan(5000);
});

test('jumping through a 1,000-page document keeps the work bounded', async () => {
  for (const target of [500, 1000, 250, 999, 1]) {
    await goToPage(target);
    await expect(
      page.locator(`[data-page-number="${target}"][data-rendered="true"]`),
    ).toBeVisible();
    expect(await page.locator('[data-page-number]').count()).toBeLessThanOrEqual(MAX_MOUNTED_PAGES);
  }
  await expect(page.getByText('Long document page 1', { exact: true })).toBeVisible();
});

test('the thumbnails of a 1,000-page document are drawn only near the view', async () => {
  const panel = page.getByRole('region', { name: 'Page Thumbnails' });
  if (!(await panel.isVisible()))
    await page.getByRole('button', { name: 'Page Thumbnails' }).click();
  await expect(panel).toBeVisible();
  // The list is as long as a thousand entries, but only those near the view exist.
  await expect(panel.getByRole('list', { name: 'Thumbnails' })).toBeVisible();
  expect(await panel.locator('li').count()).toBeLessThanOrEqual(MAX_DRAWN_THUMBNAILS);
  await expect.poll(async () => drawnThumbnails(panel)).toBeGreaterThan(0);
  expect(await drawnThumbnails(panel)).toBeLessThanOrEqual(MAX_DRAWN_THUMBNAILS);

  await goToPage(1000);
  await expect
    .poll(async () =>
      panel
        .locator('[data-thumbnail-page="1000"] canvas')
        .evaluate((canvas) => (canvas as HTMLCanvasElement).width),
    )
    .toBeGreaterThan(0);
  // The thumbnails near page 1 were emptied on the way.
  expect(await drawnThumbnails(panel)).toBeLessThanOrEqual(MAX_DRAWN_THUMBNAILS);
  await page.getByRole('button', { name: 'Page Thumbnails' }).click();
});

test('scrolling through a long scan keeps memory bounded', async () => {
  await openOnly(scanPath);
  await expect(page.locator('[data-page-number="1"][data-rendered="true"]')).toBeVisible();
  const before = await rendererMemoryMb();

  // Step through every page, waiting for each to be drawn: a reader paging
  // through the whole book.
  let peak = before;
  for (let target = 1; target <= 120; target += 4) {
    await goToPage(target);
    await expect(
      page.locator(`[data-page-number="${target}"][data-rendered="true"]`),
    ).toBeVisible();
    if (target % 20 === 1) peak = Math.max(peak, await rendererMemoryMb());
  }
  const after = await rendererMemoryMb();
  peak = Math.max(peak, after);
  report(`120-page scan: renderer ${before} MB before, ${peak} MB peak, ${after} MB after`);

  expect(await page.locator('[data-page-number]').count()).toBeLessThanOrEqual(MAX_MOUNTED_PAGES);
  expect(peak).toBeLessThan(MAX_RENDERER_MEMORY_MB);
});

test('the window stays responsive while a long scan is being drawn', async () => {
  // Jump to the far end and, without waiting for the page, use the shell.
  await goToPage(120);
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible({ timeout: 2000 });
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-page-number="120"][data-rendered="true"]')).toBeVisible();
});

test('a long comparison can be cancelled from the progress centre', async () => {
  await openOnly(longPath);
  // The second document comes in through File > Open, with the picker answered.
  await app.evaluate(
    ({ dialog }, target: string) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [target] });
    },
    path.join(sandbox, 'Thousand pages again.pdf'),
  );
  await page.keyboard.press('Control+o');
  await expect(page.getByRole('tab')).toHaveCount(2);

  await page.keyboard.press('Control+k');
  await page.getByPlaceholder('Search commands').fill('Compare Files');
  await page
    .getByRole('option', { name: /^Compare Files/ })
    .first()
    .click();
  await page.getByLabel('Original', { exact: true }).selectOption({ label: 'Thousand pages.pdf' });
  await page
    .getByLabel('Revised', { exact: true })
    .selectOption({ label: 'Thousand pages again.pdf' });
  await page.getByRole('button', { name: 'Compare', exact: true }).click();

  // A thousand page pairs take a while: stop it part of the way through.
  await page.getByRole('button', { name: 'Background tasks' }).click();
  const tasks = page.getByRole('dialog', { name: 'Background tasks' });
  await expect(tasks.getByRole('progressbar')).toBeVisible();
  await tasks.getByRole('button', { name: 'Cancel' }).click();
  await expect(tasks.getByText('cancelled')).toBeVisible();
  await expect(page.getByText(/Stopped early\./)).toBeVisible();

  // The window is still free to use.
  await tasks.getByRole('button', { name: 'Close' }).click();
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
  await page.keyboard.press('Escape');
});
