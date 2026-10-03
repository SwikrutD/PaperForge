import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { DocumentEditor } from '../../../src/main/services/documents/documentEditor';
import { DocumentService } from '../../../src/main/services/documents/documentService';
import type { QpdfService } from '../../../src/main/services/qpdf/qpdfService';
import { RecentFilesStore } from '../../../src/main/services/recentFiles/recentFilesStore';
import { SessionWorkspaces } from '../../../src/main/services/recovery/recoveryJournal';
import {
  RECOVERED_LABEL,
  SessionRecovery,
} from '../../../src/main/services/recovery/sessionRecovery';
import type { Logger } from '../../../src/main/services/logging/logger';
import { PdfLibMutationEngine } from '../../../src/pdf/mutate/pdfLibEngine';
import { threePageDocument } from '../../fixtures/pdf';

const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const qpdfMissing = { check: () => Promise.resolve(undefined) } as unknown as QpdfService;

let root = '';
let documentPath = '';
let tempDir = '';

/**
 * One run of PaperForge's main process, as far as documents go. Two of these
 * over the same temp directory are a run that crashed and the run after it.
 */
interface Run {
  workspaces: SessionWorkspaces;
  documents: DocumentService;
  editor: DocumentEditor;
  recovery: SessionRecovery;
}

async function startRun(): Promise<Run> {
  const workspaces = new SessionWorkspaces(tempDir, logger);
  const recentFiles = new RecentFilesStore(path.join(root, `profile-${Date.now()}`), logger);
  await recentFiles.load();
  const documents = new DocumentService({
    workspaces,
    recentFiles,
    logger,
    onFileChange: () => undefined,
    onOpenPathsChanged: () => undefined,
  });
  const editor = new DocumentEditor({
    documents,
    engine: new PdfLibMutationEngine(),
    qpdf: qpdfMissing,
    logger,
    workspaceDirectory: (sessionId) => workspaces.directoryFor(sessionId),
    recordState: (sessionId, state) => documents.recordEditState(sessionId, state),
    stagedAssets: () => new Map(),
  });
  const recovery = new SessionRecovery({ workspaces, documents, editor, logger });
  return { workspaces, documents, editor, recovery };
}

/** Opens the document and rotates its second page, then "crashes" by never closing. */
async function crashWithUnsavedChange(): Promise<string> {
  const run = await startRun();
  const { sessions } = await run.documents.openPaths([documentPath]);
  const sessionId = sessions[0]!.id;
  await run.editor.apply(sessionId, {
    label: 'Rotate page 2',
    operations: [{ kind: 'rotatePages', pages: [2], degrees: 90 }],
  });
  return sessionId;
}

async function rotationsOf(bytes: Uint8Array): Promise<number[]> {
  const document = await PDFDocument.load(bytes);
  return document.getPages().map((page) => page.getRotation().angle);
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'paperforge-recover-'));
  tempDir = path.join(root, 'temp');
  documentPath = path.join(root, 'Quarterly report é.pdf');
  await fs.writeFile(documentPath, threePageDocument());
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('SessionRecovery', () => {
  it('offers the unsaved changes a crash left behind', async () => {
    const crashed = await crashWithUnsavedChange();

    const next = await startRun();
    const entries = await next.recovery.list();

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      sessionId: crashed,
      dirty: true,
      unsavedChanges: true,
      fileStillExists: true,
    });
  });

  it('reopens the document with its changes back, unsaved and undoable', async () => {
    const original = await fs.readFile(documentPath);
    const crashed = await crashWithUnsavedChange();

    const next = await startRun();
    const result = await next.recovery.restore([crashed]);

    expect(result.failures).toEqual([]);
    const session = result.sessions[0]!;
    expect(next.editor.state(session.id)).toMatchObject({
      dirty: true,
      canUndo: true,
      undoLabel: RECOVERED_LABEL,
    });
    expect(await rotationsOf(await next.editor.currentBytes(session.id))).toEqual([0, 90, 0]);
    // The file itself was never touched, and the crashed session is gone.
    expect(await fs.readFile(documentPath)).toEqual(original);
    expect(await next.workspaces.listSessionIds()).toEqual([session.id]);

    await next.editor.undo(session.id);
    expect(await rotationsOf(await next.editor.currentBytes(session.id))).toEqual([0, 0, 0]);
  });

  it('records the recovered changes so a second crash keeps them too', async () => {
    const crashed = await crashWithUnsavedChange();
    const second = await startRun();
    const { sessions } = await second.recovery.restore([crashed]);

    const third = await startRun();
    const entries = await third.recovery.list();
    expect(entries).toEqual([
      expect.objectContaining({ sessionId: sessions[0]!.id, unsavedChanges: true }),
    ]);
  });

  it('reopens a document that had no unsaved changes as it is on disk', async () => {
    const first = await startRun();
    await first.documents.openPaths([documentPath]);

    const next = await startRun();
    const [entry] = await next.recovery.list();
    expect(entry).toMatchObject({ dirty: false, unsavedChanges: false });

    const result = await next.recovery.restore([entry!.sessionId]);
    expect(next.editor.state(result.sessions[0]!.id)).toMatchObject({ dirty: false });
  });

  it('saves the changes of a file that has gone somewhere new, and opens that', async () => {
    const crashed = await crashWithUnsavedChange();
    await fs.rm(documentPath);

    const next = await startRun();
    const [entry] = await next.recovery.list();
    expect(entry).toMatchObject({ fileStillExists: false, unsavedChanges: true });

    const destination = path.join(root, 'Quarterly report (recovered).pdf');
    const result = await next.recovery.saveCopy(crashed, destination);

    expect(result.sessions[0]?.file.path).toBe(destination);
    expect(await rotationsOf(await fs.readFile(destination))).toEqual([0, 90, 0]);
    expect(await next.recovery.list()).toEqual([]);
  });

  it('never follows a journal that points outside its own directory', async () => {
    const crashed = await crashWithUnsavedChange();
    const next = await startRun();
    const journal = await next.workspaces.read(crashed);
    await next.workspaces.write({
      ...journal!,
      workingCopy: path.join('..', '..', 'Quarterly report é.pdf'),
    });

    const [entry] = await next.recovery.list();
    expect(entry).toMatchObject({ dirty: true, unsavedChanges: false });
    await expect(next.recovery.saveCopy(crashed, path.join(root, 'out.pdf'))).rejects.toThrow();
  });

  it('forgets what is discarded', async () => {
    const crashed = await crashWithUnsavedChange();
    const next = await startRun();

    expect(await next.recovery.discard([crashed])).toEqual([]);
    expect(await next.workspaces.listSessionIds()).toEqual([]);
  });
});
