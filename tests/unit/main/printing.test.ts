import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PRINT_SETTINGS, type PrintSettings } from '../../../src/shared/schemas/print';
import {
  buildPrintDocument,
  resolveLandscape,
  toPrintOptions,
} from '../../../src/main/services/printing/printDocument';
import { PrintJobs, type PrintDriver } from '../../../src/main/services/printing/printJobs';
import type { Logger } from '../../../src/main/services/logging/logger';

const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

/** The smallest PNG there is: one transparent pixel. */
const PIXEL =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const settings = (patch: Partial<PrintSettings> = {}): PrintSettings => ({
  ...DEFAULT_PRINT_SETTINGS,
  ...patch,
});

describe('print orientation', () => {
  const tall = { width: 612, height: 792 };
  const wide = { width: 792, height: 612 };

  it('follows the pages when left to PaperForge', () => {
    expect(resolveLandscape('auto', [tall, tall, wide])).toBe(false);
    expect(resolveLandscape('auto', [wide, wide, tall])).toBe(true);
    // A tie keeps the paper upright.
    expect(resolveLandscape('auto', [wide, tall])).toBe(false);
  });

  it('does what it is told otherwise', () => {
    expect(resolveLandscape('landscape', [tall])).toBe(true);
    expect(resolveLandscape('portrait', [wide])).toBe(false);
  });
});

describe('print options', () => {
  it('prints silently to the chosen printer unless the Windows dialog is wanted', () => {
    const options = toPrintOptions(
      settings({ deviceName: 'Office Laser', copies: 3, collate: false, color: false }),
      true,
    );
    expect(options).toMatchObject({
      silent: true,
      deviceName: 'Office Laser',
      copies: 3,
      collate: false,
      color: false,
      landscape: true,
      margins: { marginType: 'none' },
    });

    const viaDialog = toPrintOptions(settings({ useSystemDialog: true }), false);
    expect(viaDialog.silent).toBe(false);
    expect(viaDialog).not.toHaveProperty('deviceName');
  });

  it('never names a paper size, so the printer and its dialog decide', () => {
    expect(toPrintOptions(settings(), false)).not.toHaveProperty('pageSize');
  });
});

describe('print document', () => {
  const sheets = [
    { file: 'page-00001.png', width: 612, height: 792 },
    { file: 'page-00002.png', width: 1224, height: 792 },
  ];

  it('puts one sheet per page, each with its own shape', () => {
    const html = buildPrintDocument({ title: 'Report', sheets, settings: settings() });
    expect(html.match(/class="sheet /g)).toHaveLength(2);
    expect(html).toContain('class="sheet tall" style="--a:0.7727;--w:8.5in;--h:11in"');
    expect(html).toContain('class="sheet wide"');
    expect(html).toContain('<img src="page-00001.png"');
    expect(html).toContain('<body class="fit turn centre">');
  });

  it('sizes pages in inches for actual and custom scale', () => {
    const actual = buildPrintDocument({
      title: 'Report',
      sheets,
      settings: settings({ scale: 'actual', autoRotate: false, center: false }),
    });
    expect(actual).toContain('<body class="sized">');
    expect(actual).toContain('--w:17in;--h:11in');

    const half = buildPrintDocument({
      title: 'Report',
      sheets,
      settings: settings({ scale: 'custom', customScale: 50 }),
    });
    expect(half).toContain('--w:4.25in;--h:5.5in');
  });

  it('greys pages when colour is off', () => {
    const html = buildPrintDocument({ title: 'x', sheets, settings: settings({ color: false }) });
    expect(html).toMatch(/<body class="[^"]*grey/);
  });

  it('escapes the title and reaches nothing beyond its own files', () => {
    const html = buildPrintDocument({
      title: '<script>alert("x")</script>',
      sheets,
      settings: settings(),
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain("default-src 'none'; img-src file:");
  });
});

describe('print jobs', () => {
  let root = '';
  let printed: Array<{ documentPath: string; options: Electron.WebContentsPrintOptions }> = [];
  let result = true;

  const driver: PrintDriver = async ({ documentPath, options }) => {
    // The pictures and the document must all be there when the printer reads them.
    const html = await fs.readFile(documentPath, 'utf8');
    for (const match of html.matchAll(/src="([^"]+)"/g)) {
      await fs.access(path.join(path.dirname(documentPath), match[1] ?? ''));
    }
    printed.push({ documentPath, options });
    return { printed: result };
  };

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'paperforge print ünï '));
    printed = [];
    result = true;
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('writes each page to disk and prints them in order, then cleans up', async () => {
    const jobs = new PrintJobs({ root: path.join(root, 'print'), driver, logger });
    const id = await jobs.start({ title: 'Report', settings: settings(), pages: 2 });
    await jobs.addPage({ printId: id, width: 792, height: 612, image: PIXEL });
    await jobs.addPage({ printId: id, width: 792, height: 612, image: PIXEL });

    await expect(jobs.finish(id)).resolves.toEqual({ printed: true, sheets: 2 });
    expect(printed).toHaveLength(1);
    expect(printed[0]?.options.landscape).toBe(true);
    await expect(fs.readdir(path.join(root, 'print'))).resolves.toEqual([]);
  });

  it('reports a dismissed dialog as not printed', async () => {
    result = false;
    const jobs = new PrintJobs({ root: path.join(root, 'print'), driver, logger });
    const id = await jobs.start({ title: 'Report', settings: settings(), pages: 1 });
    await jobs.addPage({ printId: id, width: 612, height: 792, image: PIXEL });
    await expect(jobs.finish(id)).resolves.toEqual({ printed: false, sheets: 0 });
  });

  it('refuses pages that are not PNG pictures, and more pages than expected', async () => {
    const jobs = new PrintJobs({ root: path.join(root, 'print'), driver, logger });
    const id = await jobs.start({ title: 'Report', settings: settings(), pages: 1 });
    await expect(
      jobs.addPage({ printId: id, width: 612, height: 792, image: 'PGh0bWw+' }),
    ).rejects.toMatchObject({ code: 'print/failed' });
    await jobs.addPage({ printId: id, width: 612, height: 792, image: PIXEL });
    await expect(
      jobs.addPage({ printId: id, width: 612, height: 792, image: PIXEL }),
    ).rejects.toMatchObject({ code: 'print/failed' });
  });

  it('throws a stopped job away without printing it', async () => {
    const jobs = new PrintJobs({ root: path.join(root, 'print'), driver, logger });
    const id = await jobs.start({ title: 'Report', settings: settings(), pages: 2 });
    await jobs.addPage({ printId: id, width: 612, height: 792, image: PIXEL });
    await jobs.cancel(id);

    expect(printed).toHaveLength(0);
    await expect(fs.readdir(path.join(root, 'print'))).resolves.toEqual([]);
    await expect(jobs.finish(id)).rejects.toMatchObject({ code: 'print/failed' });
  });

  it('clears what an earlier run left behind', async () => {
    const stale = path.join(root, 'print', 'left-over');
    await fs.mkdir(stale, { recursive: true });
    const jobs = new PrintJobs({ root: path.join(root, 'print'), driver, logger });
    await jobs.clearStale();
    await expect(fs.access(stale)).rejects.toThrow();
  });
});
