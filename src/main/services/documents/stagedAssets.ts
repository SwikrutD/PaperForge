import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppError } from '@shared/errors/appError';
import type { StampImage } from '@shared/schemas/annotation';
import type { PageSource } from '@shared/schemas/pages';
import type { StagedAsset } from '@pdf/mutate/types';

/** Bigger than this is not a stamp or a page image, it is a document. */
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
/** A document to take pages from can reasonably be much larger. */
const MAX_PDF_BYTES = 512 * 1024 * 1024;
/** What a stamp is placed at by default, in PDF units, on its longest side. */
const DEFAULT_LONGEST_SIDE = 180;

interface StagedImage extends StampImage {
  asset: StagedAsset;
}

interface StagedPdf {
  source: PageSource;
  asset: StagedAsset;
}

/**
 * Files staged for a change to use: an image to stamp or to make a page of,
 * and another PDF to take pages from.
 *
 * The reader picks a file in a native dialog, the main process reads it and
 * keeps the bytes; the renderer is handed a token and the facts it needs to
 * place the result. File data never crosses IPC, and what is staged goes when
 * the document closes.
 */
export class StagedAssets {
  private readonly staged = new Map<string, Map<string, StagedAsset>>();

  /** Reads an image and stages it, reporting the size to place it at. */
  async stageImage(sessionId: string, filePath: string): Promise<StampImage> {
    const bytes = await this.read(filePath, MAX_IMAGE_BYTES, 'image');
    const measured = measure(bytes);
    if (measured === null) {
      throw new AppError('internal/unexpected', {
        message: 'PaperForge can use PNG and JPEG images.',
        details: path.basename(filePath),
      });
    }

    const token = this.keep(sessionId, {
      kind: 'image',
      bytes,
      format: measured.format,
      width: measured.width,
      height: measured.height,
    });

    return {
      token,
      fileName: path.basename(filePath),
      ...placementSize(measured.width, measured.height),
    };
  }

  /** Reads a PDF and stages it, reporting how many pages it has to offer. */
  async stagePdf(sessionId: string, filePath: string, pageCount: number): Promise<PageSource> {
    const bytes = await this.read(filePath, MAX_PDF_BYTES, 'document');
    const token = this.keep(sessionId, { kind: 'pdf', bytes, pageCount });
    return { kind: 'pdf', token, fileName: path.basename(filePath), pageCount };
  }

  /** Stages bytes PaperForge already has, such as another open document. */
  stageBytes(sessionId: string, bytes: Uint8Array, pageCount: number): string {
    return this.keep(sessionId, { kind: 'pdf', bytes, pageCount });
  }

  /** What a change refers to by token. */
  assetsFor(sessionId: string): ReadonlyMap<string, StagedAsset> {
    return this.staged.get(sessionId) ?? new Map<string, StagedAsset>();
  }

  /** The size an image would be placed at, for an image page. */
  imageSize(sessionId: string, token: string): { width: number; height: number } | null {
    const asset = this.staged.get(sessionId)?.get(token);
    return asset?.kind === 'image' ? { width: asset.width, height: asset.height } : null;
  }

  /** Drops everything staged for a session, when its document closes. */
  dispose(sessionId: string): void {
    this.staged.delete(sessionId);
  }

  private keep(sessionId: string, asset: StagedAsset): string {
    const token = `${asset.kind}-${randomUUID()}`;
    const forSession = this.staged.get(sessionId) ?? new Map<string, StagedAsset>();
    forSession.set(token, asset);
    this.staged.set(sessionId, forSession);
    return token;
  }

  private async read(filePath: string, limit: number, what: string): Promise<Uint8Array> {
    const stats = await fs.stat(filePath).catch(() => null);
    if (stats === null || !stats.isFile()) {
      throw new AppError('io/not-found', {
        message: `That ${what} could not be read.`,
        details: filePath,
      });
    }
    if (stats.size > limit) {
      throw new AppError('internal/unexpected', {
        message: `That ${what} is too large to use here.`,
        details: `${String(Math.round(stats.size / 1024 / 1024))} MB; the limit is ${String(
          Math.round(limit / 1024 / 1024),
        )} MB`,
      });
    }
    return new Uint8Array(await fs.readFile(filePath));
  }
}

/** The size a stamp is placed at, keeping the image's own proportions. */
function placementSize(width: number, height: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  const scale = longest === 0 ? 1 : DEFAULT_LONGEST_SIDE / longest;
  return {
    width: Math.max(8, Math.round(width * scale)),
    height: Math.max(8, Math.round(height * scale)),
  };
}

/**
 * Reads the pixel size straight out of the file's header.
 *
 * Only PNG and JPEG, which are the formats the write engine can embed, and
 * they are identified by their own bytes rather than by the file's extension.
 */
export function measure(
  bytes: Uint8Array,
): { format: 'png' | 'jpeg'; width: number; height: number } | null {
  if (isPng(bytes)) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { format: 'png', width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    const size = jpegSize(bytes);
    return size === null ? null : { format: 'jpeg', ...size };
  }
  return null;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function isPng(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((value, index) => bytes[index] === value);
}

/** Walks a JPEG's segments to the frame header that states its size. */
function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1] ?? 0;
    // SOF0–SOF15, excluding the markers that are not frame headers.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = ((bytes[offset + 5] ?? 0) << 8) | (bytes[offset + 6] ?? 0);
      const width = ((bytes[offset + 7] ?? 0) << 8) | (bytes[offset + 8] ?? 0);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    const length = ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0);
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

export type { StagedImage, StagedPdf };
