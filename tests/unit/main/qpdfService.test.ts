import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  QpdfExitError,
  QpdfService,
  type QpdfRunResult,
} from '../../../src/main/services/qpdf/qpdfService';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

let sandbox = '';
let originalPath: string | undefined;

function service(configuredPath?: string | null): QpdfService {
  return new QpdfService({
    logger,
    resourcesRoot: path.join(sandbox, 'resources'),
    ...(configuredPath === undefined ? {} : { configuredPath }),
  });
}

/** A service whose child process is replaced, so exit codes can be exercised. */
class FakeQpdf extends QpdfService {
  constructor(
    private readonly outcome: QpdfRunResult | Error,
    resourcesRoot: string,
  ) {
    super({ logger, resourcesRoot, configuredPath: 'C:/fake/qpdf.exe' });
  }

  override resolve(): Promise<string | null> {
    return Promise.resolve('C:/fake/qpdf.exe');
  }

  override run(): Promise<QpdfRunResult> {
    return this.outcome instanceof Error
      ? Promise.reject(this.outcome)
      : Promise.resolve(this.outcome);
  }
}

beforeEach(async () => {
  vi.clearAllMocks();
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'paperforge-qpdf-'));
  originalPath = process.env['PATH'];
  // An empty PATH is how "qpdf is not installed" looks.
  process.env['PATH'] = '';
});

afterEach(async () => {
  process.env['PATH'] = originalPath;
  await fs.rm(sandbox, { recursive: true, force: true });
});

describe('QpdfService when qpdf is not installed', () => {
  it('reports that it is missing, in plain language', async () => {
    const status = await service().status();

    expect(status.available).toBe(false);
    expect(status.path).toBeNull();
    expect(status.version).toBeNull();
    expect(status.problem).toContain('qpdf was not found');
  });

  it('checks nothing rather than failing a save', async () => {
    await expect(service().check(path.join(sandbox, 'anything.pdf'))).resolves.toBeUndefined();
  });

  it('refuses to run with a typed error', async () => {
    await expect(service().run(['--version'])).rejects.toMatchObject({ code: 'sidecar/missing' });
  });

  it('ignores a configured path that is not there', async () => {
    const missing = service(path.join(sandbox, 'nowhere', 'qpdf.exe'));
    await expect(missing.resolve()).resolves.toBeNull();
  });
});

describe('QpdfService discovery', () => {
  it('prefers the configured executable', async () => {
    const configured = path.join(sandbox, 'tools', 'qpdf.exe');
    await fs.mkdir(path.dirname(configured), { recursive: true });
    await fs.writeFile(configured, '');

    await expect(service(configured).resolve()).resolves.toBe(configured);
  });

  it('falls back to a copy staged inside the application', async () => {
    const bundled = path.join(sandbox, 'resources', 'bundled-tools', 'qpdf', 'bin', 'qpdf.exe');
    await fs.mkdir(path.dirname(bundled), { recursive: true });
    await fs.writeFile(bundled, '');

    await expect(service().resolve()).resolves.toBe(bundled);
  });

  it('finds qpdf on the PATH', async () => {
    const onPath = path.join(sandbox, 'bin');
    await fs.mkdir(onPath, { recursive: true });
    const executable = path.join(onPath, process.platform === 'win32' ? 'qpdf.exe' : 'qpdf');
    await fs.writeFile(executable, '');
    process.env['PATH'] = onPath;

    await expect(service().resolve()).resolves.toBe(executable);
  });

  it('looks again after the configured path changes', async () => {
    const first = path.join(sandbox, 'one', 'qpdf.exe');
    const second = path.join(sandbox, 'two', 'qpdf.exe');
    for (const candidate of [first, second]) {
      await fs.mkdir(path.dirname(candidate), { recursive: true });
      await fs.writeFile(candidate, '');
    }

    const qpdf = service(first);
    await expect(qpdf.resolve()).resolves.toBe(first);
    qpdf.setConfiguredPath(second);
    await expect(qpdf.resolve()).resolves.toBe(second);
  });
});

describe('QpdfService check results', () => {
  it('reports a clean file', async () => {
    const qpdf = new FakeQpdf(
      { exitCode: 0, stdout: 'No syntax or stream encoding errors', stderr: '' },
      sandbox,
    );
    await expect(qpdf.check('C:/doc.pdf')).resolves.toEqual({
      ok: true,
      readable: true,
      output: 'No syntax or stream encoding errors',
    });
  });

  // qpdf exits 3 for warnings, which plenty of perfectly usable PDFs produce.
  it('treats warnings as readable', async () => {
    const qpdf = new FakeQpdf(new QpdfExitError(3, 'checking', 'WARNING: bad /Length'), sandbox);
    const result = await qpdf.check('C:/doc.pdf');

    expect(result).toMatchObject({ ok: false, readable: true });
    expect(result?.output).toContain('WARNING');
  });

  it('reports a file it could not make sense of', async () => {
    const qpdf = new FakeQpdf(new QpdfExitError(2, '', 'damaged xref table'), sandbox);
    await expect(qpdf.check('C:/doc.pdf')).resolves.toMatchObject({ ok: false, readable: false });
  });

  it('passes on a failure that is not qpdf refusing the file', async () => {
    const qpdf = new FakeQpdf(new Error('spawn failed'), sandbox);
    await expect(qpdf.check('C:/doc.pdf')).rejects.toThrow('spawn failed');
  });
});
