import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppError } from '@shared/errors/appError';
import type {
  PageSetup,
  SourceFailure,
  SourceKind,
  StagedSource,
  StagedSources,
} from '@shared/schemas/create';
import type { ConversionRegistry } from '@conversion/models/provider';
import type { PdfMutationEngine } from '@pdf/mutate/types';
import type { Logger } from '../logging/logger';

/**
 * The files a new document is being made from.
 *
 * A file is read here, converted to PDF pages by its provider, and kept as
 * bytes the renderer can list, preview and arrange — by name and page count,
 * never by path. Nothing is written to disk, and nothing a renderer sends can
 * name a file: it can only refer to what it was already given.
 */

/** Larger than this is not a document a reader means to combine. */
const MAX_SOURCE_BYTES = 512 * 1024 * 1024;
/** Enough for any real combine, and a limit on what one window can hold. */
const MAX_SOURCES = 500;

export interface LibrarySource {
  id: string;
  /** The window that staged it; its sources go when it closes. */
  ownerId: number;
  fileName: string;
  filePath: string;
  kind: SourceKind;
  /** The file as PDF: the bytes themselves, or what the conversion produced. */
  bytes: Uint8Array;
  pageCount: number;
  /** Size of the file the reader chose, before any conversion. */
  sizeBytes: number;
}

export interface SourceLibraryDeps {
  registry: ConversionRegistry;
  engine: PdfMutationEngine;
  logger: Logger;
}

export class SourceLibrary {
  private readonly sources = new Map<string, LibrarySource>();

  constructor(private readonly deps: SourceLibraryDeps) {}

  /** Reads and converts files, keeping the ones that worked. */
  async add(
    ownerId: number,
    filePaths: readonly string[],
    setup: PageSetup,
  ): Promise<StagedSources> {
    const added: StagedSource[] = [];
    const failures: SourceFailure[] = [];

    for (const filePath of filePaths) {
      if (this.listFor(ownerId).length + added.length >= MAX_SOURCES) {
        failures.push({
          fileName: path.basename(filePath),
          message: `PaperForge combines up to ${String(MAX_SOURCES)} files at a time.`,
        });
        continue;
      }

      try {
        added.push(await this.stage(ownerId, filePath, setup));
      } catch (error) {
        const serialized = AppError.serialize(error);
        this.deps.logger.warn('Could not stage a source file.', filePath, serialized.message);
        failures.push({
          fileName: path.basename(filePath),
          message: serialized.message,
          ...(serialized.details === undefined ? {} : { details: serialized.details }),
        });
      }
    }

    return { sources: added, failures, canceled: false };
  }

  private async stage(ownerId: number, filePath: string, setup: PageSetup): Promise<StagedSource> {
    const fileName = path.basename(filePath);
    const extension = path.extname(filePath).replace(/^\./, '').toLowerCase();
    const provider = this.deps.registry.forExtension(extension);
    if (provider === undefined) {
      throw new AppError('internal/unexpected', {
        message: `PaperForge cannot make pages from a ${extension === '' ? 'file without an extension' : `.${extension} file`} yet.`,
      });
    }

    const unavailable = await provider.availability();
    if (unavailable !== null) {
      throw new AppError('conversion/provider-unavailable', { message: unavailable });
    }

    const stats = await fs.stat(filePath);
    if (stats.size > MAX_SOURCE_BYTES) {
      throw new AppError('internal/unexpected', {
        message: `${fileName} is too large to combine.`,
        details: `${String(Math.round(stats.size / 1024 / 1024))} MB; the limit is ${String(
          Math.round(MAX_SOURCE_BYTES / 1024 / 1024),
        )} MB`,
      });
    }

    const bytes = new Uint8Array(await fs.readFile(filePath));
    const converted = await provider.toPdf({ bytes, fileName, extension, path: filePath }, setup);

    // Whatever a provider produced has to be a PDF PaperForge can read, or it
    // does not go in the list.
    const facts = await this.deps.engine.inspect(converted);
    if (facts.encrypted) {
      throw new AppError('pdf/encrypted', {
        message: `${fileName} is password protected, so its pages cannot be copied.`,
      });
    }
    if (facts.pageCount < 1) {
      throw new AppError('pdf/invalid', { message: `${fileName} has no pages.` });
    }

    const source: LibrarySource = {
      id: randomUUID(),
      ownerId,
      fileName,
      filePath,
      kind: kindOf(provider.id),
      bytes: converted,
      pageCount: facts.pageCount,
      sizeBytes: stats.size,
    };
    this.sources.set(source.id, source);
    return describe(source);
  }

  /** Everything one window has staged, in the order it was staged. */
  listFor(ownerId: number): StagedSource[] {
    return [...this.sources.values()].filter((source) => source.ownerId === ownerId).map(describe);
  }

  get(ownerId: number, id: string): LibrarySource | undefined {
    const source = this.sources.get(id);
    return source?.ownerId === ownerId ? source : undefined;
  }

  /** The bytes behind a source, for previewing it. */
  bytesOf(id: string): Uint8Array | undefined {
    return this.sources.get(id)?.bytes;
  }

  remove(ownerId: number, ids: readonly string[]): void {
    for (const id of ids) {
      if (this.sources.get(id)?.ownerId === ownerId) this.sources.delete(id);
    }
  }

  clear(ownerId: number): void {
    for (const [id, source] of this.sources) {
      if (source.ownerId === ownerId) this.sources.delete(id);
    }
  }

  /**
   * Converts the staged files again with a different page setup, which is what
   * changing the paper size after adding them has to mean. A PDF is already a
   * PDF and is left exactly as it was.
   */
  async reconvert(ownerId: number, setup: PageSetup): Promise<StagedSources> {
    const failures: SourceFailure[] = [];

    for (const source of [...this.sources.values()]) {
      if (source.ownerId !== ownerId || source.kind === 'pdf') continue;
      try {
        const replacement = await this.stage(ownerId, source.filePath, setup);
        // The new staging goes where the old one was, so the order holds.
        const staged = this.sources.get(replacement.id);
        if (staged !== undefined) this.replaceInPlace(source.id, staged);
      } catch (error) {
        const serialized = AppError.serialize(error);
        failures.push({ fileName: source.fileName, message: serialized.message });
      }
    }

    return { sources: this.listFor(ownerId), failures, canceled: false };
  }

  /** Keeps the list's order when a source is converted again. */
  private replaceInPlace(oldId: string, replacement: LibrarySource): void {
    const entries = [...this.sources.entries()];
    this.sources.clear();
    for (const [id, source] of entries) {
      if (id === replacement.id) continue;
      if (id === oldId) this.sources.set(replacement.id, replacement);
      else this.sources.set(id, source);
    }
  }
}

function describe(source: LibrarySource): StagedSource {
  return {
    id: source.id,
    fileName: source.fileName,
    kind: source.kind,
    pageCount: source.pageCount,
    sizeBytes: source.sizeBytes,
  };
}

/** What the file was before it became pages, from the provider that read it. */
function kindOf(providerId: string): SourceKind {
  switch (providerId) {
    case 'pdf':
      return 'pdf';
    case 'image':
      return 'image';
    case 'html':
      return 'html';
    default:
      return 'text';
  }
}
