import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '@shared/errors/appError';
import { savedSignatureSchema, type SavedSignature } from '@shared/schemas/signature';
import { writeFileAtomic } from '../filesystem/atomicWrite';
import { readJsonFile } from '../filesystem/readJsonFile';
import type { Logger } from '../logging/logger';

export const SIGNATURES_FILE_NAME = 'signatures.json';

/** More than anyone signs with, and small enough to read at startup. */
const MAX_SIGNATURES = 24;

const storedSchema = z.strictObject({
  version: z.literal(1),
  signatures: z.array(savedSignatureSchema).max(MAX_SIGNATURES),
});

/**
 * The signatures a reader has asked PaperForge to keep.
 *
 * Nothing is kept unless they ask: the dialog places a signature without
 * saving it unless "Remember" is ticked. What is kept lives in this
 * computer's application data and is never sent anywhere; Settings → Privacy
 * clears the lot.
 */
export class SignatureLibrary {
  private readonly filePath: string;
  private signatures: SavedSignature[] | undefined;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    directory: string,
    private readonly logger: Logger,
  ) {
    this.filePath = path.join(directory, SIGNATURES_FILE_NAME);
  }

  async list(): Promise<SavedSignature[]> {
    if (this.signatures !== undefined) return [...this.signatures];

    const raw = await readJsonFile(this.filePath);
    const stored = storedSchema.safeParse(raw);
    // A file that has been damaged is started again rather than refused: a
    // signature library is a convenience, not the reader's work.
    if (raw !== undefined && !stored.success) {
      this.logger.warn('The saved signatures could not be read; starting again.');
    }
    this.signatures = stored.success ? stored.data.signatures : [];
    return [...this.signatures];
  }

  /** Keeps a signature for next time, newest first. */
  async save(input: Omit<SavedSignature, 'id' | 'savedAt'>): Promise<SavedSignature> {
    const entry: SavedSignature = { ...input, id: randomUUID(), savedAt: new Date().toISOString() };
    const existing = await this.list();

    this.signatures = [entry, ...existing].slice(0, MAX_SIGNATURES);
    await this.persist();
    this.logger.info('Kept a signature on this computer.', entry.kind);
    return entry;
  }

  async remove(id: string): Promise<void> {
    const existing = await this.list();
    this.signatures = existing.filter((entry) => entry.id !== id);
    await this.persist();
  }

  async clear(): Promise<void> {
    this.signatures = [];
    await this.persist();
    this.logger.info('Cleared every saved signature.');
  }

  private async persist(): Promise<void> {
    const payload = JSON.stringify({ version: 1, signatures: this.signatures ?? [] }, null, 2);

    this.writeChain = this.writeChain.then(async () => {
      try {
        await writeFileAtomic(this.filePath, payload);
      } catch (error) {
        throw new AppError('io/write-failed', {
          message: 'Your saved signatures could not be written.',
          cause: error,
        });
      }
    });
    await this.writeChain;
  }
}

/** Reads a data URL's bytes, refusing anything that is not a PNG. */
export function pngFromDataUrl(dataUrl: string): Uint8Array {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim());
  if (match === null) {
    throw new AppError('internal/unexpected', {
      message: 'That signature could not be read.',
      details: 'expected a PNG data URL',
    });
  }
  return new Uint8Array(Buffer.from(match[1] as string, 'base64'));
}
