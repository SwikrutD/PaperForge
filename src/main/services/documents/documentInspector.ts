import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { AppError } from '@shared/errors/appError';
import type { DocumentFileInfo } from '@shared/schemas/document';
import { toFileSystemError } from '../filesystem/atomicWrite';

/** How much of the start of the file is searched for the PDF header. */
const HEADER_BYTES = 1024;
/** How much of the end is searched for the trailer's /Encrypt entry. */
const TRAILER_BYTES = 8192;

const HEADER_PATTERN = /%PDF-(\d\.\d)/;

/**
 * Identity of a file path, stable across restarts. Windows paths are
 * case-insensitive, so the path is folded before hashing.
 */
export function documentIdForPath(filePath: string): string {
  const normalized = path.resolve(filePath).toLowerCase();
  return createHash('sha256').update(normalized).digest('hex').slice(0, 32);
}

async function isWritable(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath, fsConstants.W_OK);
    return true;
  } catch {
    return false;
  }
}

async function readSlice(
  handle: fs.FileHandle,
  position: number,
  length: number,
): Promise<Buffer<ArrayBuffer>> {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  return buffer.subarray(0, bytesRead);
}

async function readHeaderAndTrailer(
  filePath: string,
  size: number,
): Promise<{ header: Buffer<ArrayBuffer>; trailer: Buffer<ArrayBuffer> }> {
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(filePath, 'r');
    const trailerLength = Math.min(TRAILER_BYTES, size);
    return {
      header: await readSlice(handle, 0, Math.min(HEADER_BYTES, size)),
      trailer: await readSlice(handle, Math.max(0, size - trailerLength), trailerLength),
    };
  } catch (error) {
    throw toFileSystemError(error, `read ${filePath}`);
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/**
 * Reads what can be known about a PDF without parsing it.
 *
 * Throws a typed AppError for anything that is not a readable PDF, so callers
 * can report the reason per file instead of failing a whole batch.
 */
export async function inspectDocument(filePath: string): Promise<DocumentFileInfo> {
  const resolved = path.resolve(filePath);

  let stats;
  try {
    stats = await fs.stat(resolved);
  } catch (error) {
    throw toFileSystemError(error, `open ${resolved}`);
  }

  if (!stats.isFile()) {
    throw new AppError('io/not-found', {
      message: 'That path is not a file.',
      details: resolved,
    });
  }

  const { header, trailer } = await readHeaderAndTrailer(resolved, stats.size);

  const headerMatch = HEADER_PATTERN.exec(header.toString('latin1'));
  if (headerMatch === null) {
    throw new AppError('pdf/invalid', {
      message: 'That file is not a PDF.',
      details: `No %PDF header in the first ${HEADER_BYTES} bytes of ${resolved}`,
    });
  }

  return {
    path: resolved,
    displayName: path.basename(resolved),
    sizeBytes: stats.size,
    modifiedAt: new Date(stats.mtimeMs).toISOString(),
    readOnly: !(await isWritable(resolved)),
    pdfVersion: headerMatch[1] ?? null,
    encryptionDetected: trailer.includes('/Encrypt'),
  };
}
