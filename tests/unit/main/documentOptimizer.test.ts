import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument, PDFName } from 'pdf-lib';
import { DocumentOptimizer } from '../../../src/main/services/optimize/documentOptimizer';
import type { QpdfService } from '../../../src/main/services/qpdf/qpdfService';
import { PdfLibMutationEngine } from '../../../src/pdf/mutate/pdfLibEngine';
import { OPTIMIZE_PRESETS } from '../../../src/shared/schemas/optimize';
import { threePageDocument } from '../../fixtures/pdf';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
const EDIT_STATE = {
  sessionId: 'session',
  revision: 1,
  dirty: true,
  canUndo: true,
  canRedo: false,
  undoLabel: 'Optimize PDF',
  redoLabel: null,
  savedAt: null,
  historyTrimmed: false,
};

let sandbox = '';

beforeEach(async () => {
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'paperforge-optimize-'));
});

afterEach(async () => {
  await fs.rm(sandbox, { recursive: true, force: true });
});

/** A document whose content streams are written uncompressed, padded out. */
async function bloatedDocument(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const page = document.addPage([612, 792]);
  const stream = document.context.stream('0 0 m 10 10 l S\n'.repeat(2000));
  page.node.set(PDFName.of('Contents'), document.context.register(stream));
  return document.save({ useObjectStreams: false });
}

function makeOptimizer(
  bytes: Uint8Array,
  qpdf: QpdfService,
): { optimizer: DocumentOptimizer; applyBytes: ReturnType<typeof vi.fn> } {
  const applyBytes = vi.fn(() => Promise.resolve(EDIT_STATE));
  const optimizer = new DocumentOptimizer({
    editor: { currentBytes: () => Promise.resolve(bytes), applyBytes },
    engine: new PdfLibMutationEngine(),
    qpdf,
    codec: null,
    logger,
    workspaceDirectory: () => sandbox,
  });
  return { optimizer, applyBytes };
}

const noQpdf = { resolve: () => Promise.resolve(null) } as unknown as QpdfService;

describe('the optimizer service', () => {
  it('makes a smaller document the next revision, and says how much smaller', async () => {
    const bytes = await bloatedDocument();
    const { optimizer, applyBytes } = makeOptimizer(bytes, noQpdf);

    const outcome = await optimizer.optimize('session', OPTIMIZE_PRESETS.balanced);
    expect(outcome).toMatchObject({ applied: true, qpdf: 'unavailable', linearized: false });
    expect(outcome.afterBytes).toBeLessThan(outcome.beforeBytes);
    expect(applyBytes).toHaveBeenCalledWith('session', 'Optimize PDF', expect.any(Uint8Array));
    expect(outcome.edit).toEqual(EDIT_STATE);
  });

  it('leaves the document alone when nothing came out smaller', async () => {
    // Already written compactly by pdf-lib: there is nothing left to take out.
    const document = await PDFDocument.load(threePageDocument());
    const compact = await document.save({ useObjectStreams: true });
    const { optimizer, applyBytes } = makeOptimizer(compact, noQpdf);

    const outcome = await optimizer.optimize('session', {
      ...OPTIMIZE_PRESETS.quality,
      packObjects: false,
    });
    expect(outcome.applied).toBe(false);
    expect(outcome.afterBytes).toBe(outcome.beforeBytes);
    expect(applyBytes).not.toHaveBeenCalled();
  });

  it('uses qpdf to pack and linearise when it is installed', async () => {
    const bytes = await bloatedDocument();
    const run = vi.fn(async (args: readonly string[]) => {
      const input = args[args.length - 2] as string;
      const output = args[args.length - 1] as string;
      await fs.copyFile(input, output);
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    const qpdf = {
      resolve: () => Promise.resolve('qpdf.exe'),
      version: () => Promise.resolve([12, 4] as const),
      run,
    } as unknown as QpdfService;
    const { optimizer } = makeOptimizer(bytes, qpdf);

    const outcome = await optimizer.optimize('session', {
      ...OPTIMIZE_PRESETS.balanced,
      linearize: true,
    });
    expect(outcome).toMatchObject({ applied: true, qpdf: 'used', linearized: true });
    const args = run.mock.calls[0]?.[0] ?? [];
    expect(args).toEqual(
      expect.arrayContaining([
        '--object-streams=generate',
        '--recompress-flate',
        '--compression-level=9',
        '--linearize',
      ]),
    );
    // Its working copies are gone.
    expect(await fs.readdir(path.join(sandbox, 'optimize'))).toEqual([]);
  });

  it('carries on without qpdf when qpdf fails', async () => {
    const bytes = await bloatedDocument();
    const qpdf = {
      resolve: () => Promise.resolve('qpdf.exe'),
      version: () => Promise.resolve([12, 4] as const),
      run: () => Promise.reject(new Error('boom')),
    } as unknown as QpdfService;
    const { optimizer } = makeOptimizer(bytes, qpdf);

    const outcome = await optimizer.optimize('session', OPTIMIZE_PRESETS.balanced);
    expect(outcome).toMatchObject({ applied: true, qpdf: 'failed', linearized: false });
  });
});
