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
 * Moving an image or a link, or drawing a new link, shows the change from the
 * moment the gesture ends: no frame goes back to where it was while the page is
 * rewritten and drawn again.
 */

const mainBundle = path.resolve('.vite', 'build', 'main.js');

let app: ElectronApplication;
let page: Page;
let sandbox = '';

function pageView(pageNumber: number): Locator {
  return page.locator(`[data-page-number="${String(pageNumber)}"]`);
}

function toolbar(): Locator {
  return page.getByRole('toolbar', { name: 'Editing' });
}

interface Watched {
  /** A box that must stay at `left` (CSS pixels from the page's edge). */
  box: { selector: string; left: number };
  /** Where the picture must now be red, and where it must no longer be. */
  picture?: { at: { x: number; y: number }; notAt: { x: number; y: number } };
}

interface FrameReport {
  frames: number;
  /** Frames where the box was missing or back where it was. */
  boxBehind: number;
  /** Frames where the picture was neither drawn nor stood in for where it now is. */
  pictureMissing: number;
  /** Frames where the picture still showed, uncovered, where it was. */
  pictureBehind: number;
}

/** Samples every animation frame from the gesture's end, which is what a reader sees. */
async function watchFrames(watched: Watched): Promise<void> {
  await page.evaluate((target) => {
    const report = { frames: 0, boxBehind: 0, pictureMissing: 0, pictureBehind: 0 };
    const state = { report, running: true, armed: false };
    (window as unknown as { __frames: typeof state }).__frames = state;
    // While the pointer is down the page still draws the old picture; the
    // change has to show from the moment it is let go.
    window.addEventListener(
      'pointerup',
      () => {
        state.armed = true;
      },
      { capture: true, once: true },
    );

    const red = (canvas: HTMLCanvasElement, x: number, y: number): boolean => {
      const context = canvas.getContext('2d');
      if (context === null || canvas.clientWidth === 0) return false;
      const ratio = canvas.width / canvas.clientWidth;
      const [r = 0, g = 0, b = 0] = context.getImageData(
        Math.round(x * ratio),
        Math.round(y * ratio),
        1,
        1,
      ).data;
      return r > 150 && g < 100 && b < 100;
    };

    const tick = (): void => {
      if (!state.running) return;
      if (!state.armed) {
        requestAnimationFrame(tick);
        return;
      }
      report.frames += 1;
      const view = document.querySelector('[data-page-number="1"]');
      const canvas = view?.querySelector('canvas') ?? null;
      if (view !== null && canvas !== null) {
        const origin = view.getBoundingClientRect();
        const boxes = [...view.querySelectorAll(target.box.selector)];
        const inPlace = boxes.some(
          (box) => Math.abs(box.getBoundingClientRect().left - origin.left - target.box.left) < 3,
        );
        if (!inPlace) report.boxBehind += 1;

        if (target.picture !== undefined) {
          const { at, notAt } = target.picture;
          const standIn = view.querySelector('[data-pending-image]') !== null;
          const cover = view.querySelector('[data-pending-image-cover]') !== null;
          if (!standIn && !red(canvas, at.x, at.y)) report.pictureMissing += 1;
          if (!cover && red(canvas, notAt.x, notAt.y)) report.pictureBehind += 1;
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, watched);
}

async function stopWatching(): Promise<FrameReport> {
  return page.evaluate(() => {
    const state = (window as unknown as { __frames: { running: boolean; report: FrameReport } })
      .__frames;
    state.running = false;
    return state.report;
  });
}

async function paintedRevision(): Promise<number> {
  return Number((await pageView(1).getAttribute('data-painted-revision')) ?? -1);
}

/** Waits until page 1 has drawn a new revision, and that is the one loaded. */
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
  // A few more frames, so a late jump back would still be caught.
  await page.waitForTimeout(250);
}

test.beforeAll(async () => {
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'paperforge-live-objects-'));
  app = await electron.launch({
    executablePath: electronBinary as unknown as string,
    args: [mainBundle, `--user-data-dir=${path.join(sandbox, 'profile')}`],
  });
  page = await app.firstWindow();
  await page.waitForSelector('[data-focus-region="workspace"]');

  const recovery = page.getByRole('dialog').filter({ hasText: 'Recover documents' });
  if ((await recovery.count()) > 0) await recovery.getByRole('button', { name: 'Discard' }).click();

  const documentPath = path.join(sandbox, 'Objects.pdf');
  await fs.writeFile(
    documentPath,
    buildPdf({
      pages: [
        {
          text: 'A caption',
          image: { pixels: { width: 16, height: 8 }, x: 120, y: 480, width: 200, height: 100 },
        },
      ],
    }),
  );
  await page.evaluate(
    (target: string) => window.paperforge.invoke('files:openPaths', { paths: [target] }),
    documentPath,
  );
  await page.getByRole('button', { name: 'Open Objects.pdf' }).click();
  await expect(pageView(1)).toHaveAttribute('data-rendered', 'true');

  await page.keyboard.press('Control+e');
  await expect(toolbar()).toBeVisible();
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

test('a dragged image is shown where it was dropped until the page is redrawn', async () => {
  await toolbar().getByRole('button', { name: 'Edit images' }).click();
  const image = pageView(1).locator('[data-image]').first();
  await expect(image).toBeVisible();

  const view = await pageView(1).boundingBox();
  const before = await image.boundingBox();
  if (view === null || before === null) throw new Error('the image is not on screen');
  const left = before.x - view.x;
  const top = before.y - view.y;
  const shift = Math.round(before.width * 0.75);

  await page.mouse.move(before.x + 20, before.y + 20);
  await page.mouse.down();
  await page.mouse.move(before.x + 20 + shift, before.y + 20, { steps: 8 });
  const painted = await paintedRevision();
  await watchFrames({
    box: { selector: '[data-image]', left: left + shift },
    picture: {
      // Inside where it now is, and in the part of where it was that it left.
      at: { x: left + shift + before.width - 10, y: top + before.height / 2 },
      notAt: { x: left + 10, y: top + before.height / 2 },
    },
  });
  await page.mouse.up();

  await settled(painted);
  const report = await stopWatching();

  expect(report.frames).toBeGreaterThan(5);
  expect(report).toMatchObject({ boxBehind: 0, pictureMissing: 0, pictureBehind: 0 });
  await expect(page.getByLabel('Unsaved changes')).toBeVisible();
  await expect(pageView(1).locator('[data-pending-image]')).toHaveCount(0);
});

test('a new link stays on screen from the moment it is drawn', async () => {
  await toolbar().getByRole('button', { name: 'Edit links' }).click();
  await toolbar().getByRole('button', { name: 'Add link' }).click();
  const view = await pageView(1).boundingBox();
  if (view === null) throw new Error('the page is not on screen');

  await page.mouse.move(view.x + 100, view.y + 400);
  await page.mouse.down();
  await page.mouse.move(view.x + 260, view.y + 450, { steps: 8 });
  const painted = await paintedRevision();
  await watchFrames({ box: { selector: '[data-link], [data-pending-link]', left: 100 } });
  await page.mouse.up();

  await settled(painted);
  await expect(pageView(1).locator('[data-link]')).toHaveCount(1);
  const report = await stopWatching();

  expect(report).toMatchObject({ boxBehind: 0 });
  await expect(pageView(1).locator('[data-pending-link]')).toHaveCount(0);
});

test('a dragged link stays where it was dropped', async () => {
  const link = pageView(1).locator('[data-link]').first();
  const view = await pageView(1).boundingBox();
  const before = await link.boundingBox();
  if (view === null || before === null) throw new Error('the link is not on screen');

  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 + 60, before.y + before.height / 2, {
    steps: 8,
  });
  const painted = await paintedRevision();
  await watchFrames({ box: { selector: '[data-link]', left: before.x - view.x + 60 } });
  await page.mouse.up();

  await settled(painted);
  const report = await stopWatching();

  expect(report).toMatchObject({ boxBehind: 0 });
});
