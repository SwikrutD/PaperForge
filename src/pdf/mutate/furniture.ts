import type { PDFDocument, PDFPage } from 'pdf-lib';
import { AppError } from '@shared/errors/appError';
import type { EditOperation } from '@shared/schemas/edit';
import type {
  BackgroundSettings,
  FurnitureLine,
  HeaderFooterSettings,
  WatermarkSettings,
} from '@shared/schemas/furniture';
import type { TextStyle } from '@shared/schemas/text';
import {
  appendFurniture,
  furnitureBlock,
  prependFurniture,
  removeFurniture,
  type FurnitureKind,
} from '@pdf/content/furniture';
import { contentBytes } from '@pdf/content/pageContent';
import { formatNumber } from '@pdf/content/values';
import { toWinAnsi } from '@pdf/text/layout';
import { embedImage, ensureAlphaResource } from './imageResources';
import { setPageContent } from './text';
import { ensureFontResource, standardFont } from './textResources';
import type { StagedAsset } from './types';

/**
 * Drawing the furniture: watermarks, backgrounds, headers and footers.
 *
 * Everything here is written as marked content PaperForge can find again, so
 * a watermark can be replaced or taken off without the reader having to undo
 * their way back to it. The page's own drawing is never edited — furniture
 * goes before it or after it, and comes off in one piece.
 */

interface PageWork {
  page: PDFPage;
  index: number;
  /** Where the page sits within the range being worked on, from zero. */
  position: number;
  size: { width: number; height: number };
}

export async function applyFurnitureOperation(
  document: PDFDocument,
  operation: EditOperation,
  assets: ReadonlyMap<string, StagedAsset>,
  pages: readonly number[],
): Promise<boolean> {
  if (
    operation.kind !== 'setWatermark' &&
    operation.kind !== 'setBackground' &&
    operation.kind !== 'setHeaderFooter' &&
    operation.kind !== 'removeFurniture'
  ) {
    return false;
  }

  const work = pagesOf(document, pages);

  for (const target of work) {
    switch (operation.kind) {
      case 'removeFurniture':
        strip(document, target, operation.kinds);
        break;
      case 'setWatermark':
        strip(document, target, ['watermark']);
        await drawWatermark(document, target, operation.watermark, assets);
        break;
      case 'setBackground':
        strip(document, target, ['background']);
        await drawBackground(document, target, operation.background, assets);
        break;
      case 'setHeaderFooter':
        strip(document, target, ['header', 'footer']);
        await drawHeaderFooter(document, target, operation.settings, work.length);
        break;
    }
  }
  return true;
}

function pagesOf(document: PDFDocument, pages: readonly number[]): PageWork[] {
  const work: PageWork[] = [];
  for (const [position, number] of pages.entries()) {
    const index = number - 1;
    if (index < 0 || index >= document.getPageCount()) {
      throw new AppError('internal/unexpected', {
        message: 'That page is not in this document any more.',
        details: `page ${String(number)} of ${String(document.getPageCount())}`,
      });
    }
    const page = document.getPage(index);
    work.push({ page, index, position, size: page.getSize() });
  }
  return work;
}

/** The page's drawing as it stands, as one buffer. */
function contentOf(document: PDFDocument, target: PageWork): Uint8Array {
  return contentBytes(document, target.page);
}

function strip(document: PDFDocument, target: PageWork, kinds: readonly FurnitureKind[]): void {
  const result = removeFurniture(contentOf(document, target), kinds);
  if (result.removed > 0) write(document, target, result.bytes);
}

function write(document: PDFDocument, target: PageWork, bytes: Uint8Array): void {
  setPageContent(document, target.index, bytes);
}

async function drawWatermark(
  document: PDFDocument,
  target: PageWork,
  watermark: WatermarkSettings,
  assets: ReadonlyMap<string, StagedAsset>,
): Promise<void> {
  const alpha = ensureAlphaResource(document, target.page, watermark.opacity);
  const body =
    watermark.source.kind === 'text'
      ? await watermarkText(
          document,
          target,
          watermark,
          watermark.source.text,
          watermark.source.style,
          alpha,
        )
      : await watermarkImage(document, target, watermark, watermark.source.token, assets, alpha);

  const block = furnitureBlock('watermark', body);
  const content = contentOf(document, target);
  write(
    document,
    target,
    watermark.behind ? prependFurniture(content, block) : appendFurniture(content, block),
  );
}

async function watermarkText(
  document: PDFDocument,
  target: PageWork,
  watermark: WatermarkSettings,
  text: string,
  style: TextStyle,
  alpha: string,
): Promise<string> {
  const drawn = toWinAnsi(text);
  const resource = await ensureFontResource(document, target.page, style);
  const font = await standardFont(document, style);
  const size = style.size * watermark.scale;
  const width = widthOf(font, drawn, size);

  const centre = anchor(target.size, watermark.position, width, size);
  const radians = (watermark.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  // Turned about the middle of the text, then moved to where it belongs.
  const matrix = [
    cos,
    sin,
    -sin,
    cos,
    centre.x - (width / 2) * cos + size * 0.35 * sin,
    centre.y - (width / 2) * sin - size * 0.35 * cos,
  ];

  return [
    `/${alpha} gs`,
    'BT',
    `${formatNumber(style.color.r)} ${formatNumber(style.color.g)} ${formatNumber(style.color.b)} rg`,
    `/${resource} ${formatNumber(size)} Tf`,
    `${matrix.map((value) => formatNumber(round(value))).join(' ')} Tm`,
    `${pdfText(drawn)} Tj`,
    'ET',
  ].join('\n');
}

async function watermarkImage(
  document: PDFDocument,
  target: PageWork,
  watermark: WatermarkSettings,
  token: string,
  assets: ReadonlyMap<string, StagedAsset>,
  alpha: string,
): Promise<string> {
  const asset = imageAsset(assets, token);
  const embedded = await embedImage(document, target.page, asset.bytes, asset.format);

  // A watermark image is drawn at half the page's width before scaling, so
  // that the scale the reader sets means the same for any picture.
  const base = (target.size.width * 0.5) / Math.max(1, embedded.width);
  const width = embedded.width * base * watermark.scale;
  const height = embedded.height * base * watermark.scale;

  const centre = anchor(target.size, watermark.position, width, height);
  const radians = (watermark.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  const matrix = [
    width * cos,
    width * sin,
    -height * sin,
    height * cos,
    centre.x - (width / 2) * cos + (height / 2) * sin,
    centre.y - (width / 2) * sin - (height / 2) * cos,
  ];

  return [
    `/${alpha} gs`,
    `${matrix.map((value) => formatNumber(round(value))).join(' ')} cm`,
    `/${embedded.name} Do`,
  ].join('\n');
}

async function drawBackground(
  document: PDFDocument,
  target: PageWork,
  background: BackgroundSettings,
  assets: ReadonlyMap<string, StagedAsset>,
): Promise<void> {
  const alpha = ensureAlphaResource(document, target.page, background.opacity);
  const { width, height } = target.size;
  const parts: string[] = [`/${alpha} gs`];

  if (background.fill.kind === 'color') {
    const { r, g, b } = background.fill.color;
    parts.push(
      `${formatNumber(r)} ${formatNumber(g)} ${formatNumber(b)} rg`,
      `0 0 ${formatNumber(width)} ${formatNumber(height)} re f`,
    );
  } else {
    const asset = imageAsset(assets, background.fill.token);
    const embedded = await embedImage(document, target.page, asset.bytes, asset.format);
    const ratio = embedded.width / Math.max(1, embedded.height);

    if (background.fill.fit === 'tile') {
      // A tile is a fifth of the page across, which repeats without becoming
      // a mosaic of hundreds of copies.
      const tileWidth = width / 5;
      const tileHeight = tileWidth / ratio;
      for (let y = 0; y < height; y += tileHeight) {
        for (let x = 0; x < width; x += tileWidth) {
          parts.push(
            'q',
            `${formatNumber(tileWidth)} 0 0 ${formatNumber(tileHeight)} ${formatNumber(
              round(x),
            )} ${formatNumber(round(y))} cm`,
            `/${embedded.name} Do`,
            'Q',
          );
        }
      }
    } else {
      const cover = background.fill.fit === 'fill';
      const scale = cover
        ? Math.max(width / embedded.width, height / embedded.height)
        : Math.min(width / embedded.width, height / embedded.height);
      const drawnWidth = embedded.width * scale;
      const drawnHeight = embedded.height * scale;
      parts.push(
        `${formatNumber(round(drawnWidth))} 0 0 ${formatNumber(round(drawnHeight))} ${formatNumber(
          round((width - drawnWidth) / 2),
        )} ${formatNumber(round((height - drawnHeight) / 2))} cm`,
        `/${embedded.name} Do`,
      );
    }
  }

  const content = contentOf(document, target);
  write(
    document,
    target,
    prependFurniture(content, furnitureBlock('background', parts.join('\n'))),
  );
}

async function drawHeaderFooter(
  document: PDFDocument,
  target: PageWork,
  settings: HeaderFooterSettings,
  pagesInRange: number,
): Promise<void> {
  const resource = await ensureFontResource(document, target.page, settings.style);
  const font = await standardFont(document, settings.style);
  const size = settings.style.size;
  const resolve = (value: string): string =>
    toWinAnsi(
      substitute(value, {
        page: settings.startNumber + target.position,
        pages: pagesInRange,
        date: settings.date,
        title: settings.title,
        bates:
          settings.bates === null
            ? ''
            : `${settings.bates.prefix}${String(settings.bates.start + target.position).padStart(
                settings.bates.digits,
                '0',
              )}${settings.bates.suffix}`,
      }),
    );

  for (const kind of ['header', 'footer'] as const) {
    const line: FurnitureLine = kind === 'header' ? settings.header : settings.footer;
    const baseline =
      kind === 'header' ? target.size.height - settings.margin - size : settings.margin;

    const parts: string[] = [
      'BT',
      `${formatNumber(settings.style.color.r)} ${formatNumber(
        settings.style.color.g,
      )} ${formatNumber(settings.style.color.b)} rg`,
      `/${resource} ${formatNumber(size)} Tf`,
    ];
    let drawn = 0;

    for (const place of ['left', 'center', 'right'] as const) {
      const text = resolve(line[place]).trim();
      if (text === '') continue;
      const width = widthOf(font, text, size);
      const x =
        place === 'left'
          ? settings.margin
          : place === 'center'
            ? (target.size.width - width) / 2
            : target.size.width - settings.margin - width;

      parts.push(`1 0 0 1 ${formatNumber(round(x))} ${formatNumber(round(baseline))} Tm`);
      parts.push(`${pdfText(text)} Tj`);
      drawn += 1;
    }

    parts.push('ET');
    if (drawn === 0) continue;
    write(
      document,
      target,
      appendFurniture(contentOf(document, target), furnitureBlock(kind, parts.join('\n'))),
    );
  }
}

/** Replaces the tokens a header, footer or watermark may carry. */
export function substitute(
  value: string,
  values: { page: number; pages: number; date: string; title: string; bates: string },
): string {
  return value
    .replaceAll('{{page}}', String(values.page))
    .replaceAll('{{pages}}', String(values.pages))
    .replaceAll('{{date}}', values.date)
    .replaceAll('{{title}}', values.title)
    .replaceAll('{{bates}}', values.bates);
}

/** Where a piece of furniture of a given size sits on the page. */
function anchor(
  size: { width: number; height: number },
  position: { horizontal: 'left' | 'center' | 'right'; vertical: 'top' | 'middle' | 'bottom' },
  width: number,
  height: number,
): { x: number; y: number } {
  const margin = 36;
  const x =
    position.horizontal === 'left'
      ? margin + width / 2
      : position.horizontal === 'right'
        ? size.width - margin - width / 2
        : size.width / 2;
  const y =
    position.vertical === 'top'
      ? size.height - margin - height / 2
      : position.vertical === 'bottom'
        ? margin + height / 2
        : size.height / 2;
  return { x, y };
}

function imageAsset(
  assets: ReadonlyMap<string, StagedAsset>,
  token: string,
): {
  bytes: Uint8Array;
  format: 'png' | 'jpeg';
} {
  const asset = assets.get(token);
  if (asset === undefined || asset.kind !== 'image') {
    throw new AppError('internal/unexpected', {
      message: 'That image is no longer available to draw.',
      details: `no staged image for ${token}`,
    });
  }
  return { bytes: asset.bytes, format: asset.format };
}

function widthOf(
  font: { widthOfTextAtSize: (text: string, size: number) => number },
  text: string,
  size: number,
): number {
  try {
    return font.widthOfTextAtSize(text, size);
  } catch {
    return text.length * size * 0.5;
  }
}

/** A string as a content stream spells one, with its escapes. */
function pdfText(value: string): string {
  return `(${value.replace(/([\\()])/g, '\\$1')})`;
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
