import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppError } from '@shared/errors/appError';
import type { OptimizeAnalysis, OptimizeOutcome, OptimizeSettings } from '@shared/schemas/optimize';
import type { PdfMutationEngine } from '@pdf/mutate/types';
import type { ImageCodec } from '@pdf/optimize/pixels';
import type { DocumentEditor } from '../documents/documentEditor';
import type { Logger } from '../logging/logger';
import { QpdfExitError, type QpdfService } from '../qpdf/qpdfService';

/** Where qpdf's input and output go while a document is packed. */
const OPTIMIZE_DIR_NAME = 'optimize';
/** `--compression-level` and `--recompress-flate` need qpdf 10.1 or later. */
const RECOMPRESS_SINCE: readonly [number, number] = [10, 1];
/** Packing a large document takes a while. */
const QPDF_TIMEOUT_MS = 5 * 60_000;

export interface DocumentOptimizerDeps {
  editor: Pick<DocumentEditor, 'currentBytes' | 'applyBytes'>;
  engine: PdfMutationEngine;
  qpdf: QpdfService;
  codec: ImageCodec | null;
  logger: Logger;
  workspaceDirectory: (sessionId: string) => string;
}

/**
 * Optimize PDF.
 *
 * The work happens on a copy: PaperForge's engine rewrites the revision being
 * shown, qpdf packs and linearises the result where it is installed, and only
 * a document that came out smaller — and reads back — becomes the next
 * revision. That revision is an ordinary undoable change; nothing reaches the
 * reader's file until they save (CLAUDE.md section 27).
 */
export class DocumentOptimizer {
  constructor(private readonly deps: DocumentOptimizerDeps) {}

  async analyze(sessionId: string): Promise<OptimizeAnalysis> {
    const bytes = await this.deps.editor.currentBytes(sessionId);
    const analysis = await this.deps.engine.analyzeForOptimize(bytes);
    return { ...analysis, qpdfAvailable: (await this.deps.qpdf.resolve()) !== null };
  }

  async optimize(sessionId: string, settings: OptimizeSettings): Promise<OptimizeOutcome> {
    const before = await this.deps.editor.currentBytes(sessionId);
    const optimized = await this.deps.engine.optimize(before, settings, this.deps.codec);

    let bytes = optimized.bytes;
    let qpdf: OptimizeOutcome['qpdf'] = 'notAsked';
    let linearized = false;

    if (settings.packObjects || settings.linearize) {
      const packed = await this.pack(sessionId, bytes, settings);
      qpdf = packed.status;
      if (packed.bytes !== null) {
        // Linearising adds a little; it is kept because it was asked for.
        // Otherwise qpdf's version is used only when it is the smaller one.
        if (settings.linearize || packed.bytes.length < bytes.length) {
          bytes = packed.bytes;
          linearized = settings.linearize;
        }
      }
    }

    const outcome = {
      beforeBytes: before.byteLength,
      afterBytes: bytes.byteLength,
      report: optimized.report,
      qpdf,
      linearized,
    };

    // A document that came out no smaller is left alone, unless the reader
    // asked for something other than size: grey pictures, or a linearised file.
    const asked = settings.grayscaleImages || linearized;
    if (bytes.byteLength >= before.byteLength && !asked) {
      return { ...outcome, applied: false, afterBytes: before.byteLength, edit: null };
    }

    const edit = await this.deps.editor.applyBytes(sessionId, 'Optimize PDF', bytes);
    this.deps.logger.info(
      'Optimized a document.',
      `${String(before.byteLength)} → ${String(bytes.byteLength)} bytes`,
      `qpdf ${qpdf}`,
    );
    return { ...outcome, applied: true, edit };
  }

  /** Runs the document through qpdf, returning null bytes when it cannot. */
  private async pack(
    sessionId: string,
    bytes: Uint8Array,
    settings: OptimizeSettings,
  ): Promise<{ bytes: Uint8Array | null; status: OptimizeOutcome['qpdf'] }> {
    if ((await this.deps.qpdf.resolve()) === null) return { bytes: null, status: 'unavailable' };

    const version = await this.deps.qpdf.version();
    const args = ['--object-streams=generate', '--compress-streams=y'];
    if (version !== null && atLeast(version, RECOMPRESS_SINCE)) {
      args.push('--recompress-flate', '--compression-level=9');
    }
    if (settings.linearize) args.push('--linearize');

    const directory = path.join(this.deps.workspaceDirectory(sessionId), OPTIMIZE_DIR_NAME);
    await fs.mkdir(directory, { recursive: true });
    const stem = randomUUID();
    const input = path.join(directory, `${stem}-in.pdf`);
    const output = path.join(directory, `${stem}-out.pdf`);

    try {
      await fs.writeFile(input, bytes);
      try {
        await this.deps.qpdf.run([...args, input, output], { timeoutMs: QPDF_TIMEOUT_MS });
      } catch (error) {
        // Exit code 3 is warnings, and the file qpdf wrote is still good.
        if (!(error instanceof QpdfExitError) || error.exitCode !== 3) throw error;
      }
      const written = new Uint8Array(await fs.readFile(output));
      const facts = await this.deps.engine.inspect(written);
      if (facts.pageCount < 1) throw new AppError('io/write-failed', { message: 'unreadable' });
      return { bytes: written, status: 'used' };
    } catch (error) {
      this.deps.logger.warn('qpdf could not pack an optimized document.', String(error));
      return { bytes: null, status: 'failed' };
    } finally {
      await fs.rm(input, { force: true }).catch(() => undefined);
      await fs.rm(output, { force: true }).catch(() => undefined);
    }
  }
}

function atLeast(version: readonly [number, number], floor: readonly [number, number]): boolean {
  return version[0] > floor[0] || (version[0] === floor[0] && version[1] >= floor[1]);
}
