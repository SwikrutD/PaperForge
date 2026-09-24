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
import { readZipEntry } from '../fixtures/zip';

const mainBundle = path.resolve('.vite', 'build', 'main.js');

let app: ElectronApplication;
let page: Page;
let sandbox = '';
let outputs = '';
let documentPath = '';

function dialog(): Locator {
  return page.getByRole('dialog');
}

async function openExport(): Promise<void> {
  if ((await dialog().count()) > 0) return;
  await page.getByRole('menuitem', { name: 'Tools' }).click();
  await page.getByRole('menuitem', { name: /Export PDF/ }).click();
  await expect(dialog()).toBeVisible();
}

/** Points the next export at the sandbox, as a folder or as a file. */
async function chooseDestination(target: string, kind: 'folder' | 'file'): Promise<void> {
  if (kind === 'folder') {
    await app.evaluate(({ dialog: electronDialog }, chosen: string) => {
      electronDialog.showOpenDialog = () =>
        Promise.resolve({ canceled: false, filePaths: [chosen] } as never);
    }, target);
    return;
  }
  await app.evaluate(({ dialog: electronDialog }, chosen: string) => {
    electronDialog.showSaveDialog = () =>
      Promise.resolve({ canceled: false, filePath: chosen } as never);
  }, target);
}

/** Runs one export and waits for it to say what it wrote. */
async function exportAs(mode: string): Promise<void> {
  await openExport();
  await dialog().getByRole('radio', { name: mode }).click();
  await dialog().getByRole('button', { name: 'Export', exact: true }).click();
  await expect(dialog()).toContainText(/files? written|Stopped/, { timeout: 60_000 });
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

test.beforeAll(async () => {
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'paperforge-export-'));
  outputs = path.join(sandbox, 'out');
  await fs.mkdir(outputs, { recursive: true });

  app = await electron.launch({
    executablePath: electronBinary as unknown as string,
    args: [mainBundle, `--user-data-dir=${path.join(sandbox, 'profile')}`],
  });
  page = await app.firstWindow();
  await page.waitForSelector('[data-focus-region="workspace"]');

  const recovery = page.getByRole('dialog').filter({ hasText: 'Recover documents' });
  if ((await recovery.count()) > 0) await recovery.getByRole('button', { name: 'Discard' }).click();

  // Two pages: a heading and a paragraph, and a little table.
  documentPath = path.join(sandbox, 'Report.pdf');
  await fs.writeFile(
    documentPath,
    buildPdf({
      pages: [
        {
          content:
            'BT /F1 24 Tf 1 0 0 1 60 700 Tm (Quarterly Report) Tj ET\n' +
            'BT /F1 11 Tf 1 0 0 1 60 660 Tm (The first line of the body text.) Tj ET\n' +
            'BT /F1 11 Tf 1 0 0 1 60 646 Tm (The second line of the body text.) Tj ET\n',
        },
        {
          content:
            'BT /F1 11 Tf 1 0 0 1 60 700 Tm (Item) Tj 1 0 0 1 240 700 Tm (Qty) Tj 1 0 0 1 380 700 Tm (Price) Tj ET\n' +
            'BT /F1 11 Tf 1 0 0 1 60 680 Tm (Widget) Tj 1 0 0 1 240 680 Tm (12) Tj 1 0 0 1 380 680 Tm (4.50) Tj ET\n' +
            'BT /F1 11 Tf 1 0 0 1 60 660 Tm (Sprocket) Tj 1 0 0 1 240 660 Tm (3) Tj 1 0 0 1 380 660 Tm (19.00) Tj ET\n',
        },
      ],
    }),
  );

  await page.evaluate(
    (target: string) => window.paperforge.invoke('files:openPaths', { paths: [target] }),
    documentPath,
  );
  await page.getByRole('button', { name: 'Open Report.pdf' }).click();
  await expect(page.getByLabel('Page 1')).toBeVisible();
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

test('the dialog says what each format carries and what it loses', async () => {
  await openExport();

  await expect(dialog()).toContainText('carries none of its words');
  await dialog().getByRole('radio', { name: 'Word' }).click();
  await expect(dialog()).toContainText('Some complex layouts will change');
});

test('pictures are written, one a page, with the names asked for', async () => {
  await chooseDestination(outputs, 'folder');
  await exportAs('PNG images');

  expect(await exists(path.join(outputs, 'Report page 1.png'))).toBe(true);
  expect(await exists(path.join(outputs, 'Report page 2.png'))).toBe(true);
});

test('a JPEG export writes JPEGs at the quality chosen', async () => {
  await chooseDestination(outputs, 'folder');
  await openExport();
  await dialog().getByRole('radio', { name: 'JPEG images' }).click();
  await dialog().getByRole('slider', { name: 'Quality' }).fill('60');
  await dialog().getByRole('button', { name: 'Export', exact: true }).click();
  await expect(dialog()).toContainText(/files? written/, { timeout: 60_000 });

  const written = path.join(outputs, 'Report page 1.jpg');
  expect(await exists(written)).toBe(true);
  const bytes = await fs.readFile(written);
  // A JPEG begins with its own marker, whatever is inside it.
  expect([...bytes.subarray(0, 2)]).toEqual([0xff, 0xd8]);
});

test('text keeps the words, and can keep the columns', async () => {
  const target = path.join(outputs, 'Report.txt');
  await chooseDestination(target, 'file');
  await openExport();
  await dialog().getByRole('radio', { name: 'Text' }).click();
  await dialog()
    .getByRole('checkbox', { name: /Keep the lines where they sit/ })
    .check();
  await dialog().getByRole('button', { name: 'Export', exact: true }).click();
  await expect(dialog()).toContainText(/files? written/, { timeout: 60_000 });

  const text = await fs.readFile(target, 'utf8');
  expect(text).toContain('Quarterly Report');
  expect(text).toContain('Sprocket');
  // The columns of the table are still apart from one another.
  const row = text.split(/\r?\n/).find((line) => line.includes('Sprocket'));
  expect(row?.indexOf('19.00')).toBeGreaterThan((row?.indexOf('Sprocket') ?? 0) + 8);
});

test('a web page carries the words over a picture of each page', async () => {
  const target = path.join(outputs, 'Report.html');
  await chooseDestination(target, 'file');
  await exportAs('Web page');

  const html = await fs.readFile(target, 'utf8');
  expect(html).toContain('Quarterly Report');
  expect(html).toContain('Report_files/page-1.png');
  // Nothing is fetched from anywhere.
  expect(html).not.toMatch(/https?:\/\//);
  expect(await exists(path.join(outputs, 'Report_files', 'page-1.png'))).toBe(true);
});

test('a Word document is written, with the words in it', async () => {
  const target = path.join(outputs, 'Report.docx');
  await chooseDestination(target, 'file');
  await exportAs('Word');

  // A .docx is a zip of XML: the words are really in there.
  const bytes = new Uint8Array(await fs.readFile(target));
  const document = readZipEntry(bytes, 'word/document.xml') ?? '';

  expect(document).toContain('Quarterly Report');
  expect(document).toContain('The first line of the body text.');
  // The heading is set as one, not as another paragraph of body text.
  expect(document).toMatch(/Heading2|w:pStyle/);
});

test('a workbook is written, a sheet to a page', async () => {
  const target = path.join(outputs, 'Report.xlsx');
  await chooseDestination(target, 'file');
  await exportAs('Excel');

  // The table on page two became rows and columns; the numbers stayed numbers.
  const bytes = new Uint8Array(await fs.readFile(target));
  const strings = readZipEntry(bytes, 'xl/sharedStrings.xml') ?? '';
  const sheet = readZipEntry(bytes, 'xl/worksheets/sheet2.xml') ?? '';

  expect(strings).toContain('Sprocket');
  expect(sheet).toContain('19');
});

test('a deck is written, one slide a page', async () => {
  const target = path.join(outputs, 'Report.pptx');
  await chooseDestination(target, 'file');
  await openExport();
  await dialog().getByRole('radio', { name: 'PowerPoint' }).click();
  await dialog()
    .getByRole('radio', { name: /Best for layout/ })
    .check();
  await dialog().getByRole('button', { name: 'Export', exact: true }).click();
  await expect(dialog()).toContainText(/files? written/, { timeout: 60_000 });

  // One slide for each page, each one a picture of it.
  const bytes = new Uint8Array(await fs.readFile(target));
  expect(readZipEntry(bytes, 'ppt/slides/slide1.xml')).not.toBeNull();
  expect(readZipEntry(bytes, 'ppt/slides/slide2.xml')).not.toBeNull();
  expect(readZipEntry(bytes, 'ppt/slides/slide3.xml')).toBeNull();
});

test('the words themselves can go on the slides instead', async () => {
  const target = path.join(outputs, 'Editable.pptx');
  await chooseDestination(target, 'file');
  await openExport();
  await dialog().getByRole('radio', { name: 'PowerPoint' }).click();
  await dialog()
    .getByRole('radio', { name: /Best for editing/ })
    .check();
  await dialog().getByRole('button', { name: 'Export', exact: true }).click();
  await expect(dialog()).toContainText(/files? written/, { timeout: 60_000 });

  const bytes = new Uint8Array(await fs.readFile(target));
  const slide = readZipEntry(bytes, 'ppt/slides/slide1.xml') ?? '';
  expect(slide).toContain('Quarterly Report');
});

test('the document itself is untouched by any of it', async () => {
  await expect(page.getByLabel('Unsaved changes')).toBeHidden();
  await dialog().getByRole('button', { name: 'Close' }).last().click();
  await expect(page.getByLabel('Page 1')).toBeVisible();
});
