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
 * The field the text editor opens behaves like a text field: a click puts
 * the caret where it lands, a double click selects the word, and neither
 * throws away what has been typed.
 */
const mainBundle = path.resolve('.vite', 'build', 'main.js');

let app: ElectronApplication;
let page: Page;
let sandbox = '';

function run(): Locator {
  return page.getByLabel('Page 1').locator('[data-run]').first();
}

function field(): Locator {
  return page.locator('[data-run] input');
}

/** Where the caret, or the selection, is in the field. */
function selection(): Promise<{ start: number; end: number; value: string }> {
  return field().evaluate((element) => {
    const input = element as HTMLInputElement;
    return { start: input.selectionStart ?? -1, end: input.selectionEnd ?? -1, value: input.value };
  });
}

/** The point in the field just after its first `count` characters. */
function pointAfter(count: number): Promise<{ x: number; y: number }> {
  return field().evaluate((element, characters) => {
    const input = element as HTMLInputElement;
    const style = getComputedStyle(input);
    const context = document.createElement('canvas').getContext('2d');
    if (context === null) throw new Error('no canvas');
    context.font = `${style.fontSize} ${style.fontFamily}`;
    const box = input.getBoundingClientRect();
    // The field scrolls when its text is wider than it is.
    const before = context.measureText(input.value.slice(0, characters)).width - input.scrollLeft;
    // A little short of the boundary, so the click is inside the character
    // that ends there and the caret lands after it only when it should.
    return {
      x: box.left + parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth) + before - 1,
      y: box.top + box.height / 2,
    };
  }, count);
}

async function openField(): Promise<void> {
  // The first click selects the run, and opens it once it is selected.
  await run().click();
  if ((await field().count()) === 0) await run().click();
  await expect(field()).toHaveValue('The first line');
}

test.beforeAll(async () => {
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'paperforge-field-'));
  app = await electron.launch({
    executablePath: electronBinary as unknown as string,
    args: [mainBundle, `--user-data-dir=${path.join(sandbox, 'profile')}`],
  });
  page = await app.firstWindow();
  await page.waitForSelector('[data-focus-region="workspace"]');

  const recovery = page.getByRole('dialog').filter({ hasText: 'Recover documents' });
  if ((await recovery.count()) > 0) await recovery.getByRole('button', { name: 'Discard' }).click();

  const documentPath = path.join(sandbox, 'Field.pdf');
  await fs.writeFile(
    documentPath,
    buildPdf({ pages: [{ content: 'BT /F1 24 Tf 60 700 Td (The first line) Tj ET' }] }),
  );
  await page.evaluate(
    (target: string) => window.paperforge.invoke('files:openPaths', { paths: [target] }),
    documentPath,
  );
  await page.getByRole('button', { name: 'Open Field.pdf' }).click();
  await expect(page.getByLabel('Page 1').getByText('The first line')).toBeVisible();
  await page.keyboard.press('Control+e');
  await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
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

test('a click in the field puts the caret where it lands, instead of selecting it all', async () => {
  await openField();
  expect(await selection()).toEqual({ start: 0, end: 14, value: 'The first line' });

  // "The f|irst line": after the fifth character, give or take how the
  // field's font measures against the canvas's.
  const point = await pointAfter(5);
  await page.mouse.click(point.x, point.y);
  const { start, end, value } = await selection();
  expect(value).toBe('The first line');
  expect(start).toBe(end);
  expect(Math.abs(start - 5)).toBeLessThanOrEqual(1);
  await page.keyboard.press('Escape');
});

test('typing goes in at the caret, and another click keeps what was typed', async () => {
  await openField();
  const point = await pointAfter(5);
  await page.mouse.click(point.x, point.y);
  await page.keyboard.type('X');

  const typed = await selection();
  expect(typed.value.replace('X', '')).toBe('The first line');
  expect(Math.abs(typed.value.indexOf('X') - 5)).toBeLessThanOrEqual(1);

  const later = await pointAfter(10);
  await page.mouse.click(later.x, later.y);
  const after = await selection();
  expect(after.value).toBe(typed.value);
  expect(after.start).toBe(after.end);
  await page.keyboard.press('Escape');
});

test('a double click selects the word', async () => {
  await openField();
  // Inside "first".
  const point = await pointAfter(7);
  await page.mouse.dblclick(point.x, point.y);

  const { start, end, value } = await selection();
  expect(value.slice(start, end).trim()).toBe('first');
  await page.keyboard.press('Escape');
});
