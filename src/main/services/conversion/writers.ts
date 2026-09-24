import fs from 'node:fs/promises';
import path from 'node:path';
import { Document, HeadingLevel, ImageRun, Packer, PageBreak, Paragraph, TextRun } from 'docx';
import ExcelJS from 'exceljs';
import PptxGenJS from 'pptxgenjs';
import type { ExportOptions, ExportPagePayload } from '@shared/schemas/convert';
import {
  cellsOf,
  detectTable,
  pageText,
  pageTextPreservingLayout,
  toBlocks,
  toLines,
} from '@conversion/analysis/layout';
import { writeFileAtomic } from '../filesystem/atomicWrite';

/**
 * Turning what the window read off each page into a file.
 *
 * Each writer is honest about what it carries: a picture writer keeps the page
 * and loses the words; a document writer keeps the words and lays them out
 * again, which is a reading of the geometry and not the page itself.
 */

export interface WriterContext {
  /** Where the files go. */
  directory: string;
  /** The document's own name, without its extension. */
  documentName: string;
  options: ExportOptions;
}

export interface Writer {
  /** Takes one page. Returns the paths it wrote, if it wrote any. */
  addPage(payload: ExportPagePayload): Promise<string[]>;
  /** Writes whatever was gathered. Returns the paths it wrote. */
  finish(): Promise<string[]>;
}

/** The name a file gets, from the reader's template. */
/** Notepad still reads UTF-8 better when the file starts with one. */
const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);

/** A form feed between pages, which is what a text file has always used. */
const PAGE_BREAK = String.fromCharCode(10, 12, 10);

export function fileNameFor(context: WriterContext, page: number, index: number): string {
  const base = context.options.naming
    .replace(/\{name\}/g, context.documentName)
    .replace(/\{page\}/g, String(page))
    .replace(/\{n\}/g, String(index + 1))
    .trim();
  return safeName(base === '' ? `${context.documentName} page ${String(page)}` : base);
}

/** A name Windows will take, whatever the reader typed. */
export function safeName(name: string): string {
  const flattened = name.split(/[\\/]/).pop() ?? name;
  const cleaned = flattened
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"|?*\u0000-\u001f]/g, '')
    .replace(/\.+$/, '')
    .trim();
  return cleaned === '' ? 'page' : cleaned.slice(0, 120);
}

/** Bytes of a base64 picture the window rendered. */
function pictureOf(payload: ExportPagePayload): Buffer {
  return Buffer.from(payload.image ?? '', 'base64');
}

/** One picture per page: the page exactly as it looks, and none of its words. */
export class ImageWriter implements Writer {
  private written = 0;

  constructor(private readonly context: WriterContext) {}

  async addPage(payload: ExportPagePayload): Promise<string[]> {
    if (payload.image === null) return [];

    const extension = this.context.options.mode === 'jpeg' ? 'jpg' : this.context.options.mode;
    const name = `${fileNameFor(this.context, payload.page, this.written)}.${extension}`;
    const target = path.join(this.context.directory, name);

    await writeFileAtomic(target, pictureOf(payload));
    this.written += 1;
    return [target];
  }

  finish(): Promise<string[]> {
    return Promise.resolve([]);
  }
}

/** The words, and nothing else. */
export class TextWriter implements Writer {
  private readonly pages: string[] = [];

  constructor(private readonly context: WriterContext) {}

  addPage(payload: ExportPagePayload): Promise<string[]> {
    const lines = toLines(payload.items);
    this.pages.push(
      this.context.options.preserveLayout
        ? pageTextPreservingLayout(lines)
        : pageText(toLines(payload.items)),
    );
    return Promise.resolve([]);
  }

  async finish(): Promise<string[]> {
    const target = path.join(this.context.directory, `${safeName(this.context.documentName)}.txt`);
    // A form feed between pages is what a text file has always used, and a
    // byte order mark is what Notepad wants.
    await writeFileAtomic(target, `${BYTE_ORDER_MARK}${this.pages.join(PAGE_BREAK)}\n`);
    return [target];
  }
}

/** The words where they sit, over a picture of the page. */
export class HtmlWriter implements Writer {
  private readonly sections: string[] = [];
  private readonly assets: string[] = [];

  constructor(private readonly context: WriterContext) {}

  private get assetFolder(): string {
    return `${safeName(this.context.documentName)}_files`;
  }

  async addPage(payload: ExportPagePayload): Promise<string[]> {
    let picture = '';
    if (payload.image !== null) {
      const folder = path.join(this.context.directory, this.assetFolder);
      await fs.mkdir(folder, { recursive: true });
      const name = `page-${String(payload.page)}.png`;
      const target = path.join(folder, name);
      await writeFileAtomic(target, pictureOf(payload));
      this.assets.push(target);
      picture = `<img class="page-picture" src="${this.assetFolder}/${name}" alt="Page ${String(
        payload.page,
      )}">`;
    }

    const words = toLines(payload.items)
      .map((line) => {
        const left = round(line.left);
        // HTML measures from the top; a PDF measures from the bottom.
        const top = round(payload.height - line.y - line.height);
        return `<span style="left:${left}pt;top:${top}pt;font-size:${round(
          line.height,
        )}pt">${escapeHtml(line.text)}</span>`;
      })
      .join('\n      ');

    this.sections.push(
      [
        `    <section class="page" style="width:${round(payload.width)}pt;height:${round(
          payload.height,
        )}pt" aria-label="Page ${String(payload.page)}">`,
        picture === '' ? '' : `      ${picture}`,
        words === '' ? '' : `      ${words}`,
        '    </section>',
      ]
        .filter((line) => line !== '')
        .join('\n'),
    );
    return Promise.resolve([]);
  }

  async finish(): Promise<string[]> {
    const target = path.join(this.context.directory, `${safeName(this.context.documentName)}.html`);
    const html = [
      '<!doctype html>',
      '<html lang="en">',
      '  <head>',
      '    <meta charset="utf-8">',
      `    <title>${escapeHtml(this.context.documentName)}</title>`,
      '    <style>',
      '      body { margin: 0; background: #f3f3f3; font-family: Georgia, "Times New Roman", serif; }',
      '      .page { position: relative; margin: 16pt auto; background: #fff; box-shadow: 0 1pt 4pt rgba(0,0,0,.2); overflow: hidden; }',
      '      .page-picture { position: absolute; inset: 0; width: 100%; height: 100%; }',
      '      .page span { position: absolute; white-space: pre; color: transparent; }',
      '      .page:not(:has(.page-picture)) span { color: #111; }',
      '    </style>',
      '  </head>',
      '  <body>',
      ...this.sections,
      '  </body>',
      '</html>',
      '',
    ].join('\n');

    await writeFileAtomic(target, html);
    return [target, ...this.assets];
  }
}

/** Paragraphs a word processor can edit. */
export class DocxWriter implements Writer {
  private readonly paragraphs: Paragraph[] = [];

  constructor(private readonly context: WriterContext) {}

  addPage(payload: ExportPagePayload): Promise<string[]> {
    if (this.paragraphs.length > 0) {
      this.paragraphs.push(new Paragraph({ children: [new PageBreak()] }));
    }

    const lines = toLines(payload.items);
    const table = detectTable(lines);
    const inTable = new Set(table?.rows ?? []);

    for (const block of toBlocks(lines.filter((line) => !inTable.has(line)))) {
      this.paragraphs.push(
        new Paragraph({
          ...(block.heading ? { heading: HeadingLevel.HEADING_2 } : {}),
          children: [new TextRun({ text: block.text, size: Math.round(block.height * 2) })],
        }),
      );
    }

    // A table PaperForge is sure enough of becomes tab-separated lines: a
    // shape it can read, without pretending to have read a table's borders.
    if (table !== null) {
      for (const row of table.rows) {
        this.paragraphs.push(
          new Paragraph({
            children: [new TextRun({ text: cellsOf(row, table.columns).join('\t') })],
          }),
        );
      }
    }

    if (payload.image !== null) {
      this.paragraphs.push(
        new Paragraph({
          children: [
            new ImageRun({
              type: 'png',
              data: pictureOf(payload),
              transformation: {
                width: Math.round(payload.width),
                height: Math.round(payload.height),
              },
            }),
          ],
        }),
      );
    }

    return Promise.resolve([]);
  }

  async finish(): Promise<string[]> {
    const document = new Document({ sections: [{ children: this.paragraphs }] });
    const target = path.join(this.context.directory, `${safeName(this.context.documentName)}.docx`);
    await writeFileAtomic(target, await Packer.toBuffer(document));
    return [target];
  }
}

/** Rows and columns where PaperForge can see them. */
export class XlsxWriter implements Writer {
  private readonly workbook = new ExcelJS.Workbook();

  constructor(private readonly context: WriterContext) {
    this.workbook.creator = 'PaperForge';
  }

  addPage(payload: ExportPagePayload): Promise<string[]> {
    const sheet = this.workbook.addWorksheet(`Page ${String(payload.page)}`);
    const lines = toLines(payload.items);
    const table = detectTable(lines);

    if (table === null) {
      // No shape to read: a line a row, which loses nothing and claims nothing.
      for (const line of lines) sheet.addRow([line.text]);
      return Promise.resolve([]);
    }

    for (const row of table.rows) {
      sheet.addRow(cellsOf(row, table.columns).map((cell) => asNumberOrText(cell)));
    }
    return Promise.resolve([]);
  }

  async finish(): Promise<string[]> {
    const target = path.join(this.context.directory, `${safeName(this.context.documentName)}.xlsx`);
    const buffer = await this.workbook.xlsx.writeBuffer();
    await writeFileAtomic(target, new Uint8Array(buffer));
    return [target];
  }
}

/** One slide per page. */
export class PptxWriter implements Writer {
  private readonly deck = new PptxGenJS();
  private sized = false;

  constructor(private readonly context: WriterContext) {
    this.deck.author = 'PaperForge';
  }

  addPage(payload: ExportPagePayload): Promise<string[]> {
    // The deck takes the shape of the first page, in inches.
    if (!this.sized) {
      this.deck.defineLayout({
        name: 'PaperForge',
        width: payload.width / 72,
        height: payload.height / 72,
      });
      this.deck.layout = 'PaperForge';
      this.sized = true;
    }

    const slide = this.deck.addSlide();

    if (payload.image !== null) {
      slide.addImage({
        data: `data:image/png;base64,${payload.image}`,
        x: 0,
        y: 0,
        w: payload.width / 72,
        h: payload.height / 72,
      });
      return Promise.resolve([]);
    }

    for (const block of toBlocks(toLines(payload.items))) {
      slide.addText(block.text, {
        x: block.left / 72,
        y: (payload.height - block.lines[0]!.y - block.height) / 72,
        w: Math.max(0.5, (block.right - block.left) / 72),
        h: Math.max(0.2, (block.height * block.lines.length * 1.3) / 72),
        fontSize: Math.max(6, Math.round(block.height)),
        bold: block.heading,
        valign: 'top',
      });
    }
    return Promise.resolve([]);
  }

  async finish(): Promise<string[]> {
    const target = path.join(this.context.directory, `${safeName(this.context.documentName)}.pptx`);
    const data = (await this.deck.write({ outputType: 'nodebuffer' })) as Buffer;
    await writeFileAtomic(target, data);
    return [target];
  }
}

/** A cell that reads as a number becomes one, so a total can be taken of it. */
function asNumberOrText(cell: string): string | number {
  if (cell === '') return '';
  const cleaned = cell.replace(/[\s,\u00a0]/gu, '');
  const parsed = Number(cleaned);
  return cleaned !== '' && Number.isFinite(parsed) && /\d/.test(cleaned) ? parsed : cell;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
