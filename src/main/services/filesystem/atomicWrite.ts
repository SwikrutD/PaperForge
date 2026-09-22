import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '@shared/errors/appError';

function errorCodeOf(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
}

/** Maps Node filesystem errno codes onto PaperForge's typed error categories. */
export function toFileSystemError(error: unknown, context: string): AppError {
  const code = errorCodeOf(error);
  switch (code) {
    case 'ENOENT':
      return new AppError('io/not-found', { details: `${context} (ENOENT)`, cause: error });
    case 'EACCES':
    case 'EPERM':
    case 'EBUSY':
      return new AppError('io/permission-denied', {
        details: `${context} (${code})`,
        cause: error,
      });
    case 'ENOSPC':
      return new AppError('io/out-of-space', { details: `${context} (ENOSPC)`, cause: error });
    default:
      return new AppError('io/write-failed', {
        details: `${context}${code === undefined ? '' : ` (${code})`}`,
        cause: error,
      });
  }
}

export interface AtomicWriteOptions {
  /**
   * Called with the temporary file once it is on disk and flushed, before it
   * replaces the destination. Throwing here leaves the destination untouched,
   * which is how the save pipeline refuses to publish a file it cannot reopen.
   */
  validate?: (tempPath: string) => Promise<void>;
}

/**
 * Writes a file without ever leaving a half-written destination behind:
 * write to a sibling temp file, flush it to disk, optionally check it, then
 * rename over the target. This is what the document save pipeline builds on.
 */
export async function writeFileAtomic(
  filePath: string,
  data: string | Uint8Array,
  options: AtomicWriteOptions = {},
): Promise<void> {
  const directory = path.dirname(filePath);
  const tempPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${Date.now().toString(36)}.tmp`,
  );

  try {
    await fs.mkdir(directory, { recursive: true });
  } catch (error) {
    throw toFileSystemError(error, `create directory ${directory}`);
  }

  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(
      tempPath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC,
    );
    await handle.writeFile(data);
    await handle.sync();
  } catch (error) {
    throw toFileSystemError(error, `write temporary file for ${filePath}`);
  } finally {
    await handle?.close().catch(() => undefined);
  }

  if (options.validate !== undefined) {
    try {
      await options.validate(tempPath);
    } catch (error) {
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  try {
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw toFileSystemError(error, `replace ${filePath}`);
  }
}
