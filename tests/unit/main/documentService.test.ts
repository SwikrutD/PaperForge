import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentService } from '../../../src/main/services/documents/documentService';
import { RecentFilesStore } from '../../../src/main/services/recentFiles/recentFilesStore';
import { SessionWorkspaces } from '../../../src/main/services/recovery/recoveryJournal';
import type { Logger } from '../../../src/main/services/logging/logger';
import type { FileChangeEvent } from '../../../src/shared/schemas/document';

const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const PDF = Buffer.from(
  '%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n',
  'latin1',
);

let root = '';
let documentsDir = '';
let tempDir = '';
let workspaces: SessionWorkspaces;
let recentFiles: RecentFilesStore;
let changes: FileChangeEvent[] = [];
let openPaths: string[][] = [];

function makeService(): DocumentService {
  return new DocumentService({
    workspaces,
    recentFiles,
    logger,
    onFileChange: (event) => changes.push(event),
    onOpenPathsChanged: (paths) => openPaths.push(paths),
  });
}

async function writePdf(name: string): Promise<string> {
  const filePath = path.join(documentsDir, name);
  await fs.writeFile(filePath, PDF);
  return filePath;
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'paperforge-docs-'));
  documentsDir = path.join(root, 'documents');
  tempDir = path.join(root, 'temp');
  await fs.mkdir(documentsDir, { recursive: true });
  workspaces = new SessionWorkspaces(tempDir, logger);
  recentFiles = new RecentFilesStore(root, logger);
  await recentFiles.load();
  changes = [];
  openPaths = [];
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('DocumentService', () => {
  it('opens a document, creates its working directory and records it as recent', async () => {
    const service = makeService();
    const filePath = await writePdf('report.pdf');

    const result = await service.openPaths([filePath]);

    expect(result.failures).toEqual([]);
    expect(result.sessions).toHaveLength(1);
    const session = result.sessions[0]!;
    expect(session.file.displayName).toBe('report.pdf');
    expect(session.dirty).toBe(false);

    const journal = await workspaces.read(session.id);
    expect(journal).toMatchObject({ path: filePath, dirty: false, displayName: 'report.pdf' });
    expect(recentFiles.list().map((entry) => entry.path)).toEqual([filePath]);
    expect(openPaths.at(-1)).toEqual([filePath]);

    await service.closeAll();
  });

  it('keeps a failure per file instead of failing the batch', async () => {
    const service = makeService();
    const good = await writePdf('good.pdf');
    const bad = path.join(documentsDir, 'notes.txt');
    await fs.writeFile(bad, 'not a pdf');
    const missing = path.join(documentsDir, 'gone.pdf');

    const result = await service.openPaths([good, bad, missing]);

    expect(result.sessions.map((session) => session.file.path)).toEqual([good]);
    expect(result.failures.map((failure) => failure.code)).toEqual(['pdf/invalid', 'io/not-found']);
    expect(result.failures[0]?.message).toBe('That file is not a PDF.');

    await service.closeAll();
  });

  it('returns the existing session when the same file is opened twice', async () => {
    const service = makeService();
    const filePath = await writePdf('once.pdf');

    const first = await service.openPaths([filePath]);
    const second = await service.openPaths([filePath.toUpperCase()]);

    expect(second.sessions[0]?.id).toBe(first.sessions[0]?.id);
    expect(service.list()).toHaveLength(1);

    await service.closeAll();
  });

  it('removes the working directory on close, which is what recovery relies on', async () => {
    const service = makeService();
    const filePath = await writePdf('report.pdf');
    const { sessions } = await service.openPaths([filePath]);
    const sessionId = sessions[0]!.id;

    expect(await workspaces.listSessionIds()).toEqual([sessionId]);

    await service.close(sessionId);

    expect(await workspaces.listSessionIds()).toEqual([]);
    expect(service.list()).toEqual([]);
    expect(openPaths.at(-1)).toEqual([]);
  });

  it('records unsaved changes in the journal', async () => {
    const service = makeService();
    const filePath = await writePdf('report.pdf');
    const { sessions } = await service.openPaths([filePath]);
    const sessionId = sessions[0]!.id;

    await service.setDirty(sessionId, true);

    expect(service.get(sessionId)?.dirty).toBe(true);
    expect((await workspaces.read(sessionId))?.dirty).toBe(true);

    await service.closeAll();
  });

  it('does not touch the recent files list when restoring a session', async () => {
    const service = makeService();
    const filePath = await writePdf('restored.pdf');

    await service.openPaths([filePath], { recordAsRecent: false });

    expect(recentFiles.list()).toEqual([]);
    await service.closeAll();
  });

  it('reports a file that changed outside PaperForge', async () => {
    const service = makeService();
    const filePath = await writePdf('watched.pdf');
    const { sessions } = await service.openPaths([filePath]);
    const sessionId = sessions[0]!.id;

    await fs.writeFile(filePath, Buffer.concat([PDF, Buffer.from('% appended\n')]));

    await vi.waitFor(
      () => {
        expect(changes.some((event) => event.sessionId === sessionId)).toBe(true);
      },
      { timeout: 4000 },
    );

    const event = changes.find((candidate) => candidate.sessionId === sessionId)!;
    expect(event.change).toBe('modified');
    expect(event.file?.sizeBytes).toBeGreaterThan(PDF.length);

    await service.closeAll();
  });

  it('reports a file that disappeared', async () => {
    const service = makeService();
    const filePath = await writePdf('doomed.pdf');
    const { sessions } = await service.openPaths([filePath]);
    const sessionId = sessions[0]!.id;

    await fs.rm(filePath);

    await vi.waitFor(
      () => {
        expect(changes.some((event) => event.change === 'deleted')).toBe(true);
      },
      { timeout: 4000 },
    );

    expect(changes.at(-1)).toMatchObject({ sessionId, change: 'deleted', file: null });
    await service.closeAll();
  });
});
