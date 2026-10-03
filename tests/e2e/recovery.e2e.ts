import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import electronBinary from 'electron';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { threePageDocument } from '../fixtures/pdf';

const mainBundle = path.resolve('.vite', 'build', 'main.js');

let sandbox = '';
let documentPath = '';
let app: ElectronApplication | undefined;

/**
 * Each launch shares one profile and one temp directory, which is where the
 * session directories a crash leaves behind live — so the second launch sees
 * what the first one left, and the machine's real temp folder is never used.
 */
async function launch(): Promise<Page> {
  const temp = path.join(sandbox, 'temp');
  await fs.mkdir(temp, { recursive: true });
  app = await electron.launch({
    executablePath: electronBinary as unknown as string,
    args: [mainBundle, `--user-data-dir=${path.join(sandbox, 'profile')}`],
    env: { ...process.env, TEMP: temp, TMP: temp },
  });
  const page = await app.firstWindow();
  await page.waitForSelector('[data-focus-region="workspace"]');
  return page;
}

/**
 * Ends the application the way a crash or Task Manager would: no quit event,
 * no cleanup. The whole tree goes, so no helper process keeps the single
 * instance lock for the next launch.
 */
async function killProcessTree(pid: number): Promise<void> {
  await new Promise<void>((resolve) => {
    execFile('taskkill', ['/F', '/T', '/PID', String(pid)], () => resolve());
  });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}

async function rotationsOnDisk(filePath: string): Promise<number[]> {
  const task = getDocument({ data: new Uint8Array(await fs.readFile(filePath)) });
  const document = await task.promise;
  const rotations: number[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    rotations.push((await document.getPage(pageNumber)).rotate);
  }
  await task.destroy();
  return rotations;
}

test.beforeAll(async () => {
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'paperforge-recovery-'));
  documentPath = path.join(sandbox, 'Crash test é.pdf');
  await fs.writeFile(documentPath, threePageDocument());
});

test.afterAll(async () => {
  await app?.close().catch(() => undefined);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await fs.rm(sandbox, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
});

test('unsaved changes survive the application being killed', async () => {
  const before = await fs.readFile(documentPath);

  // First run: open, change, and die without saving or closing.
  let page = await launch();
  await page.evaluate(
    (target: string) => window.paperforge.invoke('files:openPaths', { paths: [target] }),
    documentPath,
  );
  await page.getByRole('button', { name: 'Open Crash test é.pdf' }).click();
  await expect(page.getByText('PaperForge alpha page')).toBeVisible();
  await page.getByRole('button', { name: 'Rotate Page Right' }).click();
  await expect(page.getByLabel('Unsaved changes')).toBeVisible();

  await killProcessTree(app!.process().pid!);
  app = undefined;

  // The file on disk is exactly as it was.
  expect(await fs.readFile(documentPath)).toEqual(before);

  // Second run: recovery is offered, and says the changes were kept.
  page = await launch();
  const dialog = page.getByRole('dialog', { name: 'Recover documents' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Crash test é.pdf', { exact: true })).toBeVisible();
  await expect(dialog.getByText(/unsaved changes kept/)).toBeVisible();

  await dialog.getByRole('button', { name: 'Reopen all' }).click();
  await expect(dialog).toBeHidden();

  // The document comes back with the change, still unsaved.
  await expect(page.getByRole('tab', { name: /Crash test é\.pdf/ })).toBeVisible();
  await expect(page.getByLabel('Unsaved changes')).toBeVisible();
  await expect
    .poll(async () => {
      const box = await page.locator('[data-page-number]').first().boundingBox();
      return box !== null && box.width > box.height;
    })
    .toBe(true);
  await expect(page.getByRole('button', { name: /^Undo/ })).toBeEnabled();

  // Saving writes the recovered change to the file.
  await page.keyboard.press('Control+s');
  await expect(page.getByText(/was saved/)).toBeVisible();
  expect(await rotationsOnDisk(documentPath)).toEqual([90, 0, 0]);
});

test('a clean exit leaves nothing to recover', async () => {
  await app!.close();
  app = undefined;

  const page = await launch();
  // Recovery is looked for once the shell is up; give it the moment it takes.
  await page.waitForTimeout(1500);
  await expect(page.getByRole('dialog', { name: 'Recover documents' })).toHaveCount(0);
});
