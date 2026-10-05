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

// Each test carries on from the document the one before it left.
test.describe.configure({ mode: 'serial' });

/**
 * Changes appear in place: the page never goes blank, never unmounts, and a new
 * mark never disappears while the document is being rewritten underneath it.
 *
 * A watcher samples every animation frame while a change is made, which is
 * exactly what a reader would see.
 */

const mainBundle = path.resolve('.vite', 'build', 'main.js');

let app: ElectronApplication;
let page: Page;
let sandbox = '';

function pageView(pageNumber: number): Locator {
  return page.locator(`[data-page-number="${String(pageNumber)}"]`);
}

function runsOn(pageNumber: number): Locator {
  return pageView(pageNumber).locator('[data-run]');
}

function shownOnPage(pageNumber: number, text: string): Locator {
  return page.getByLabel(`Page ${String(pageNumber)}`).getByText(text);
}

interface FrameReport {
  frames: number;
  /** Frames where page 1 was not in the document at all. */
  unmounted: number;
  /** Frames where page 1's canvas held no picture. */
  blank: number;
  /** Frames where the change was neither drawn by the page nor shown over it. */
  missing: number;
}

/**
 * What must stay visible from the moment a change is made: a coloured spot on
 * page 1 (in its CSS pixels), or an element standing in for the change until
 * the page has been drawn with it.
 */
interface Watched {
  spot?: { x: number; y: number; radius: number };
  /** Shown over the page while it has not yet been redrawn. */
  standIn?: string;
}

/** Starts sampling every animation frame, which is exactly what a reader sees. */
async function watchFrames(watched: Watched | null): Promise<void> {
  await page.evaluate((target) => {
    const report = { frames: 0, unmounted: 0, blank: 0, missing: 0 };
    const state = { report, running: true, armedAt: null as number | null };
    (window as unknown as { __frames: typeof state }).__frames = state;

    const coloured = (canvas: HTMLCanvasElement, x: number, y: number, r: number): boolean => {
      const context = canvas.getContext('2d');
      if (context === null || canvas.clientWidth === 0) return false;
      const ratio = canvas.width / canvas.clientWidth;
      const size = Math.max(1, Math.round(r * 2 * ratio));
      const { data } = context.getImageData(
        Math.round((x - r) * ratio),
        Math.round((y - r) * ratio),
        size,
        size,
      );
      for (let index = 0; index < data.length; index += 4) {
        const red = data[index] ?? 255;
        const green = data[index + 1] ?? 255;
        const blue = data[index + 2] ?? 255;
        if (Math.max(red, green, blue) - Math.min(red, green, blue) > 40) return true;
      }
      return false;
    };

    const tick = (): void => {
      if (!state.running) return;
      report.frames += 1;
      const view = document.querySelector('[data-page-number="1"]');
      const canvas = view?.querySelector('canvas') ?? null;
      if (view === null || canvas === null) {
        report.unmounted += 1;
      } else {
        const context = canvas.getContext('2d');
        const centre = context?.getImageData(
          Math.floor(canvas.width / 2),
          Math.floor(canvas.height / 2),
          1,
          1,
        ).data;
        // A page is painted white at the least; a cleared canvas is transparent.
        if (canvas.width <= 1 || centre === undefined || (centre[3] ?? 0) === 0) {
          report.blank += 1;
        }
        if (target !== null && state.armedAt !== null) {
          const standIn = target.standIn ?? '[data-annotation-preview], [data-pending-annotation]';
          const shownOver = view.querySelector(standIn) !== null;
          const drawn =
            target.spot === undefined
              ? Number(view.getAttribute('data-painted-revision') ?? -1) > state.armedAt
              : coloured(canvas, target.spot.x, target.spot.y, target.spot.radius);
          if (!shownOver && !drawn) report.missing += 1;
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, watched);
}

/** The revision page 1 has drawn, or -1 before it has drawn any. */
async function paintedRevision(): Promise<number> {
  return Number((await pageView(1).getAttribute('data-painted-revision')) ?? -1);
}

/** From now on the change must be visible. */
async function armWatch(): Promise<void> {
  const painted = await paintedRevision();
  await page.evaluate((revision) => {
    (window as unknown as { __frames: { armedAt: number } }).__frames.armedAt = revision;
  }, painted);
}

async function stopWatching(): Promise<FrameReport> {
  return page.evaluate(() => {
    const state = (window as unknown as { __frames: { running: boolean; report: FrameReport } })
      .__frames;
    state.running = false;
    return state.report;
  });
}

/**
 * Waits until page 1 has drawn a revision other than `from`, and that is the
 * one the viewer has loaded.
 */
async function settled(from: number): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate((previous) => {
        const view = document.querySelector('[data-page-number="1"]');
        const painted = view?.getAttribute('data-painted-revision') ?? null;
        return (
          painted !== null &&
          painted !== String(previous) &&
          painted === view?.getAttribute('data-revision')
        );
      }, from),
    )
    .toBe(true);
  // A few more frames, so a late flash would still be caught.
  await page.waitForTimeout(250);
}

async function showCommentTools(): Promise<void> {
  const toolbar = page.getByRole('toolbar', { name: 'Comment tools' });
  if (!(await toolbar.isVisible())) await page.keyboard.press('Control+m');
  await expect(toolbar).toBeVisible();
}

test.beforeAll(async () => {
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'paperforge-live-'));
  app = await electron.launch({
    executablePath: electronBinary as unknown as string,
    args: [mainBundle, `--user-data-dir=${path.join(sandbox, 'profile')}`],
  });
  page = await app.firstWindow();
  await page.waitForSelector('[data-focus-region="workspace"]');

  const recovery = page.getByRole('dialog').filter({ hasText: 'Recover documents' });
  if ((await recovery.count()) > 0) await recovery.getByRole('button', { name: 'Discard' }).click();

  const documentPath = path.join(sandbox, 'Live.pdf');
  await fs.writeFile(
    documentPath,
    buildPdf({
      pages: [
        {
          content:
            'BT /F1 18 Tf 1 0 0 1 60 700 Tm (The first line) Tj 0 -24 Td (The second line) Tj ET\n',
        },
        { text: 'The next page' },
      ],
    }),
  );
  await page.evaluate(
    (target: string) => window.paperforge.invoke('files:openPaths', { paths: [target] }),
    documentPath,
  );
  await page.getByRole('button', { name: 'Open Live.pdf' }).click();
  await expect(shownOnPage(1, 'The first line')).toBeVisible();
  await expect(pageView(1)).toHaveAttribute('data-rendered', 'true');
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

test('a drawn rectangle stays on screen, and the page never flashes, while it is written', async () => {
  await showCommentTools();
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();

  const box = await pageView(1).boundingBox();
  if (box === null) throw new Error('the page is not on screen');
  const from = { x: 120, y: 300 };
  const to = { x: 280, y: 420 };
  const before = await paintedRevision();

  // The left edge of the rectangle, half way down.
  await watchFrames({ spot: { x: from.x, y: (from.y + to.y) / 2, radius: 4 } });
  await page.mouse.move(box.x + from.x, box.y + from.y);
  await page.mouse.down();
  await page.mouse.move(box.x + to.x, box.y + to.y, { steps: 8 });
  await armWatch();
  await page.mouse.up();

  await settled(before);
  const report = await stopWatching();

  expect(report.frames).toBeGreaterThan(5);
  expect(report).toMatchObject({ unmounted: 0, blank: 0, missing: 0 });
  await expect(page.getByLabel('Unsaved changes')).toBeVisible();
  await expect(pageView(1).locator('[data-pending-annotation]')).toHaveCount(0);
  await page.keyboard.press('Escape');
});

test('undo and redo swap the picture without a blank frame', async () => {
  await watchFrames(null);
  let before = await paintedRevision();
  await page.keyboard.press('Control+z');
  await settled(before);
  await expect(page.getByLabel('Unsaved changes')).toBeHidden();

  before = await paintedRevision();
  await page.keyboard.press('Control+y');
  await settled(before);
  await expect(page.getByLabel('Unsaved changes')).toBeVisible();
  const report = await stopWatching();

  expect(report).toMatchObject({ unmounted: 0, blank: 0 });
});

test('editing text keeps the page on screen and shows the new words at once', async () => {
  await page.keyboard.press('Control+e');
  await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
  await runsOn(1).first().click();
  await runsOn(1).first().click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Changed live');
  const before = await paintedRevision();

  // From Enter on, every frame shows the typed words — in the field, then over
  // the old ones — or the page drawn with them.
  await watchFrames({ standIn: '[data-pending-text], [data-run] input' });
  await armWatch();
  await page.keyboard.press('Enter');
  await settled(before);
  const report = await stopWatching();

  expect(report).toMatchObject({ unmounted: 0, blank: 0, missing: 0 });
  await expect(shownOnPage(1, 'Changed live')).toBeVisible();
  await expect(pageView(1).locator('[data-pending-text]')).toHaveCount(0);
});

test('clicking another line keeps what was typed instead of throwing it away', async () => {
  // Runs are read again for the new revision before they can be opened.
  await expect(runsOn(1).first()).toHaveAttribute('title', 'Changed live');
  await runsOn(1).nth(1).click();
  await runsOn(1).nth(1).click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Kept on click');

  // Pointing at another line is how a reader moves on.
  await runsOn(1).first().click();

  await expect(shownOnPage(1, 'Kept on click')).toBeVisible();
  await expect(runsOn(1).nth(1)).toHaveAttribute('title', 'Kept on click');
});

test('clicking the empty page keeps what was typed too', async () => {
  await runsOn(1).first().click();
  await runsOn(1).first().click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Kept on page click');

  const box = await pageView(1).boundingBox();
  if (box === null) throw new Error('the page is not on screen');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height - 80);

  await expect(shownOnPage(1, 'Kept on page click')).toBeVisible();
});

test('an edit after an undo is shown, not a stale copy of the undone one', async () => {
  // Undo the last edit, then make a different one. The new revision must not
  // be mistaken for the one that was undone.
  await page.keyboard.press('Control+z');
  await expect(runsOn(1).first()).toHaveAttribute('title', 'Changed live');
  await runsOn(1).first().click();
  await runsOn(1).first().click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('After undo');
  await page.keyboard.press('Enter');

  await expect(shownOnPage(1, 'After undo')).toBeVisible();
  await expect(runsOn(1).first()).toHaveAttribute('title', 'After undo');
  await expect(runsOn(1).nth(1)).toHaveAttribute('title', 'Kept on click');
});
