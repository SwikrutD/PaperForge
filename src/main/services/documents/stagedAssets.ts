import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppError } from '@shared/errors/appError';
import type { StampImage } from '@shared/schemas/annotation';
import type { PageSource } from '@shared/schemas/pages';
import type { StagedAsset } from '@pdf/mutate/types';
import { measureImage } from '@shared/utils/imageHeader';

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
    const measured = measureImage(bytes);
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

  /**
   * Stages a picture PaperForge already holds, such as a signature the window
   * has just drawn. The bytes are checked like any other image.
   */
  stageImageBytes(sessionId: string, bytes: Uint8Array, fileName: string): StampImage {
    const measured = measureImage(bytes);
    if (measured === null || bytes.length > MAX_IMAGE_BYTES) {
      throw new AppError('internal/unexpected', {
        message: 'That picture could not be used.',
        details: measured === null ? 'not a PNG or JPEG' : 'too large',
      });
    }

    const token = this.keep(sessionId, {
      kind: 'image',
      bytes,
      format: measured.format,
      width: measured.width,
      height: measured.height,
    });

    return { token, fileName, ...placementSize(measured.width, measured.height) };
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

export type { StagedImage, StagedPdf };
