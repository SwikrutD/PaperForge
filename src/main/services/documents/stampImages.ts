import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppError } from '@shared/errors/appError';
import type { StampImage } from '@shared/schemas/annotation';
import type { StampImageBytes } from '@pdf/mutate/types';

/** Bigger than this is not a stamp, it is a document in its own right. */
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
/** What a stamp is placed at by default, in PDF units, on its longest side. */
const DEFAULT_LONGEST_SIDE = 180;

interface Staged {
  token: string;
  bytes: Uint8Array;
  format: 'png' | 'jpeg';
  width: number;
  height: number;
  fileName: string;
}

/**
 * Images staged for stamping.
 *
 * The reader picks an image in a native dialog, the main process reads it and
 * keeps the bytes; the renderer is handed a token, a name and the size. Image
 * data never crosses IPC, and the staged copies go when the document closes.
 */
export class StampImages {
  private readonly staged = new Map<string, Map<string, Staged>>();

  /** Reads an image file and stages it for one session. */
  async stage(sessionId: string, filePath: string): Promise<StampImage> {
    const stats = await fs.stat(filePath).catch(() => null);
    if (stats === null || !stats.isFile()) {
      throw new AppError('io/not-found', {
        message: 'That image could not be read.',
        details: filePath,
      });
    }
    if (stats.size > MAX_IMAGE_BYTES) {
      throw new AppError('internal/unexpected', {
        message: 'That image is too large to stamp onto a page.',
        details: `${String(Math.round(stats.size / 1024 / 1024))} MB; the limit is 32 MB`,
      });
    }

    const bytes = new Uint8Array(await fs.readFile(filePath));
    const measured = measure(bytes);
    if (measured === null) {
      throw new AppError('internal/unexpected', {
        message: 'PaperForge can stamp PNG and JPEG images.',
        details: path.basename(filePath),
      });
    }

    const token = `stamp-${randomUUID()}`;
    const entry: Staged = {
      token,
      bytes,
      format: measured.format,
      ...placementSize(measured.width, measured.height),
      fileName: path.basename(filePath),
    };

    const forSession = this.staged.get(sessionId) ?? new Map<string, Staged>();
    forSession.set(token, entry);
    this.staged.set(sessionId, forSession);

    return {
      token,
      fileName: entry.fileName,
      width: entry.width,
      height: entry.height,
    };
  }

  /** The bytes a mutation needs, by token. */
  imagesFor(sessionId: string): ReadonlyMap<string, StampImageBytes> {
    const forSession = this.staged.get(sessionId);
    const images = new Map<string, StampImageBytes>();
    if (forSession === undefined) return images;
    for (const [token, entry] of forSession) {
      images.set(token, { bytes: entry.bytes, format: entry.format });
    }
    return images;
  }

  /** Drops everything staged for a session, when its document closes. */
  dispose(sessionId: string): void {
    this.staged.delete(sessionId);
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
