import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { AppError } from '../../../src/shared/errors/appError';
import type { DocumentSession } from '../../../src/shared/schemas/document';
import type { EditTransaction } from '../../../src/shared/schemas/edit';
import {
  DocumentEditor,
  type EditorDocuments,
} from '../../../src/main/services/documents/documentEditor';
import { PdfLibMutationEngine } from '../../../src/pdf/mutate/pdfLibEngine';
import type { QpdfCheckResult, QpdfService } from '../../../src/main/services/qpdf/qpdfService';
import type { PdfMutationEngine } from '../../../src/pdf/mutate/types';
import { threePageDocument } from '../../fixtures/pdf';

const SESSION_ID = 'session-1';

/**
 * The reads a hand-written engine does not exercise. The editor under test
 * never calls them, and stating so keeps each stub about the one thing it is
 * there to prove.
 */
const READ_ONLY_STUBS = {
  readProperties: () => Promise.reject(new Error('not used in this test')),
  readAttachments: () => Promise.resolve([]),
  extractAttachment: () => Promise.resolve(null),
  scanHiddenInformation: () => Promise.reject(new Error('not used in this test')),
  planRedactions: () => Promise.reject(new Error('not used in this test')),
  findForRedaction: () => Promise.reject(new Error('not used in this test')),
} satisfies Partial<PdfMutationEngine>;

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

/** qpdf is not installed in the test environment, which is the common case. */
const qpdfMissing = { check: () => Promise.resolve(undefined) } as unknown as QpdfService;

/** A qpdf whose verdict the test chooses, and whose calls it can count. */
function fakeQpdf(result: QpdfCheckResult): { qpdf: QpdfService; check: Mock } {
  const check = vi.fn(() => Promise.resolve(result));
  return { qpdf: { check } as unknown as QpdfService, check };
}

let sandbox = '';
let documentPath = '';
let workspace = '';

const rotate = (page: number): EditTransaction => ({
  label: `Rotate page ${page}`,
  operations: [{ kind: 'rotatePages', pages: [page], degrees: 90 }],
});

const deletePage = (page: number): EditTransaction => ({
  label: `Delete page ${page}`,
  operations: [{ kind: 'deletePages', pages: [page] }],
});

async function statOf(filePath: string): Promise<{ size: number; modifiedAt: string }> {
  const stats = await fs.stat(filePath);
  return { size: stats.size, modifiedAt: new Date(stats.mtimeMs).toISOString() };
}

async function makeSession(
  filePath: string,
  overrides: Partial<DocumentSession> = {},
): Promise<DocumentSession> {
  const { size, modifiedAt } = await statOf(filePath);
  const session: DocumentSession = {
    id: SESSION_ID,
    documentId: 'doc-1',
    file: {
      path: filePath,
      displayName: path.basename(filePath),
      sizeBytes: size,
      modifiedAt,
      readOnly: false,
      pdfVersion: '1.7',
      encryptionDetected: false,
    },
    openedAt: new Date().toISOString(),
    dirty: false,
    ...overrides,
  };
  return session;
}

/** A stand-in for the document service, recording what the editor asks of it. */
function makeDocuments(session: DocumentSession): EditorDocuments & { session: DocumentSession } {
  const state = { session };
  return {
    get state() {
      return state;
    },
    get session() {
      return state.session;
    },
    get: () => state.session,
    retarget: async (_sessionId: string, filePath: string) => {
      const { size, modifiedAt } = await statOf(filePath);
      state.session = {
        ...state.session,
        file: {
          ...state.session.file,
          path: filePath,
          displayName: path.basename(filePath),
          sizeBytes: size,
          modifiedAt,
        },
      };
      return state.session;
    },
    markSavedByUs: async () => {
      const { size, modifiedAt } = await statOf(state.session.file.path);
      state.session = {
        ...state.session,
        file: { ...state.session.file, sizeBytes: size, modifiedAt },
      };
      return state.session;
    },
  } as EditorDocuments & { session: DocumentSession };
}

function makeEditor(
  documents: EditorDocuments,
  options: { engine?: PdfMutationEngine; qpdf?: QpdfService } = {},
): { editor: DocumentEditor; setDirty: Mock } {
  const setDirty = vi.fn(() => Promise.resolve());
  const editor = new DocumentEditor({
    documents,
    engine: options.engine ?? new PdfLibMutationEngine(),
    qpdf: options.qpdf ?? qpdfMissing,
    logger,
    workspaceDirectory: () => workspace,
    setDirty,
    stagedAssets: () => new Map(),
  });
  return { editor, setDirty };
}

/** Page count and rotations, read back with the render engine. */
async function readBack(filePath: string): Promise<{ pages: number; rotations: number[] }> {
  const task = getDocument({ data: new Uint8Array(await fs.readFile(filePath)) });
  const document = await task.promise;
  const rotations: number[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    rotations.push((await document.getPage(pageNumber)).rotate);
  }
  const pages = document.numPages;
  await task.destroy();
  return { pages, rotations };
}

beforeEach(async () => {
  vi.clearAllMocks();
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'paperforge-editor-'));
  workspace = path.join(sandbox, 'session');
  await fs.mkdir(workspace, { recursive: true });
  documentPath = path.join(sandbox, 'Report.pdf');
  await fs.writeFile(documentPath, threePageDocument());
});

afterEach(async () => {
  await fs.rm(sandbox, { recursive: true, force: true });
});

describe('DocumentEditor', () => {
  it('reports a document nobody has changed', async () => {
    const documents = makeDocuments(await makeSession(documentPath));
    const { editor } = makeEditor(documents);

    expect(editor.state(SESSION_ID)).toMatchObject({
      revision: 0,
      dirty: false,
      canUndo: false,
      canRedo: false,
    });
    expect(editor.currentBytesPath(SESSION_ID)).toBeUndefined();
  });

  it('changes a document without touching the file it came from', async () => {
    const documents = makeDocuments(await makeSession(documentPath));
    const { editor, setDirty } = makeEditor(documents);
    const before = await fs.readFile(documentPath);

    const state = await editor.apply(SESSION_ID, rotate(2));

    expect(state).toMatchObject({ revision: 1, dirty: true, canUndo: true, canRedo: false });
    expect(state.undoLabel).toBe('Rotate page 2');
    expect(setDirty).toHaveBeenLastCalledWith(SESSION_ID, true);

    // The original is untouched; the change lives in the working copy.
    expect(await fs.readFile(documentPath)).toEqual(before);
    const working = editor.currentBytesPath(SESSION_ID);
    expect(working).toBeDefined();
    expect(await readBack(working as string)).toEqual({ pages: 3, rotations: [0, 90, 0] });
  });

  it('takes a change back and puts it again', async () => {
    const documents = makeDocuments(await makeSession(documentPath));
    const { editor } = makeEditor(documents);

    await editor.apply(SESSION_ID, rotate(1));
    await editor.apply(SESSION_ID, deletePage(3));
    expect(await readBack(editor.currentBytesPath(SESSION_ID) as string)).toMatchObject({
      pages: 2,
    });

    const undone = await editor.undo(SESSION_ID);
    expect(undone).toMatchObject({ revision: 1, dirty: true, canRedo: true });
    expect(await readBack(editor.currentBytesPath(SESSION_ID) as string)).toEqual({
      pages: 3,
      rotations: [90, 0, 0],
    });

    const back = await editor.undo(SESSION_ID);
    expect(back).toMatchObject({ revision: 0, dirty: false, canUndo: false });
    expect(await readBack(editor.currentBytesPath(SESSION_ID) as string)).toEqual({
      pages: 3,
      rotations: [0, 0, 0],
    });

    const redone = await editor.redo(SESSION_ID);
    expect(redone).toMatchObject({ revision: 1, dirty: true });
  });

  it('saves the current revision and reopens what it wrote', async () => {
    const documents = makeDocuments(await makeSession(documentPath));
    const { editor, setDirty } = makeEditor(documents);
    await editor.apply(SESSION_ID, rotate(2));

    const outcome = await editor.save({ sessionId: SESSION_ID, mode: 'save' });

    expect(outcome.canceled).toBe(false);
    expect(outcome.path).toBe(documentPath);
    expect(outcome.edit).toMatchObject({ dirty: false, revision: 1 });
    expect(outcome.checkedWithQpdf).toBe(false);
    expect(setDirty).toHaveBeenLastCalledWith(SESSION_ID, false);

    // The change is in the file the reader opened.
    expect(await readBack(documentPath)).toEqual({ pages: 3, rotations: [0, 90, 0] });
  });

  it('can still undo past a save, and saving again is possible', async () => {
    const documents = makeDocuments(await makeSession(documentPath));
    const { editor } = makeEditor(documents);
    await editor.apply(SESSION_ID, rotate(2));
    await editor.save({ sessionId: SESSION_ID, mode: 'save' });

    const undone = await editor.undo(SESSION_ID);
    expect(undone).toMatchObject({ revision: 0, dirty: true, canUndo: false });

    await editor.save({ sessionId: SESSION_ID, mode: 'save' });
    expect(await readBack(documentPath)).toEqual({ pages: 3, rotations: [0, 0, 0] });
  });

  it('writes a copy without changing the document being worked on', async () => {
    const documents = makeDocuments(await makeSession(documentPath));
    const { editor } = makeEditor(documents);
    await editor.apply(SESSION_ID, deletePage(1));
    const original = await fs.readFile(documentPath);

    const copyPath = path.join(sandbox, 'Report copy.pdf');
    const outcome = await editor.save({
      sessionId: SESSION_ID,
      mode: 'saveCopy',
      destination: copyPath,
    });

    expect(outcome.path).toBe(copyPath);
    // A copy is not a save: the document is still dirty afterwards.
    expect(outcome.edit).toMatchObject({ dirty: true });
    expect(await readBack(copyPath)).toMatchObject({ pages: 2 });
    expect(await fs.readFile(documentPath)).toEqual(original);
  });

  it('saves under a new name and carries on there', async () => {
    const documents = makeDocuments(await makeSession(documentPath));
    const { editor } = makeEditor(documents);
    await editor.apply(SESSION_ID, deletePage(2));

    const target = path.join(sandbox, 'Renamed.pdf');
    const outcome = await editor.save({
      sessionId: SESSION_ID,
      mode: 'saveAs',
      destination: target,
    });

    expect(outcome.session?.file.path).toBe(target);
    expect(outcome.edit).toMatchObject({ dirty: false });
    expect(await readBack(target)).toMatchObject({ pages: 2 });
    // The file it came from is left as it was.
    expect(await readBack(documentPath)).toMatchObject({ pages: 3 });
  });

  it('goes back to the saved version and can undo that too', async () => {
    const documents = makeDocuments(await makeSession(documentPath));
    const { editor } = makeEditor(documents);
    await editor.apply(SESSION_ID, rotate(1));
    await editor.save({ sessionId: SESSION_ID, mode: 'save' });
    await editor.apply(SESSION_ID, deletePage(3));

    const reverted = await editor.revert(SESSION_ID);
    expect(reverted).toMatchObject({ revision: 1, dirty: false });
    expect(await readBack(editor.currentBytesPath(SESSION_ID) as string)).toMatchObject({
      pages: 3,
    });

    // Reverting is itself a step, not a cliff.
    expect(reverted.canRedo).toBe(true);
    expect(await editor.redo(SESSION_ID)).toMatchObject({ revision: 2, dirty: true });
  });

  it('leaves the original alone when the file it produced cannot be reopened', async () => {
    const brokenEngine: PdfMutationEngine = {
      // The document being edited is fine; the "saved" file is not.
      inspect: (bytes: Uint8Array) =>
        Promise.resolve(
          bytes.byteLength < 100
            ? { pageCount: 0, encrypted: false }
            : { pageCount: 3, encrypted: false },
        ),
      apply: () => Promise.resolve({ bytes: new TextEncoder().encode('not a pdf'), pageCount: 0 }),
      readAnnotations: () => Promise.resolve([]),
      ...READ_ONLY_STUBS,
    };
    const documents = makeDocuments(await makeSession(documentPath));
    const { editor } = makeEditor(documents, { engine: brokenEngine });
    const before = await fs.readFile(documentPath);

    await editor.apply(SESSION_ID, rotate(1));
    await expect(editor.save({ sessionId: SESSION_ID, mode: 'save' })).rejects.toMatchObject({
      code: 'io/write-failed',
    });

    expect(await fs.readFile(documentPath)).toEqual(before);
    // And nothing was left lying beside it.
    const leftovers = (await fs.readdir(sandbox)).filter((name) => name.includes('.tmp'));
    expect(leftovers).toEqual([]);
  });

  it('refuses to save over a file that changed on disk, unless told to', async () => {
    const documents = makeDocuments(await makeSession(documentPath));
    const { editor } = makeEditor(documents);
    await editor.apply(SESSION_ID, rotate(1));

    // Somebody else writes the file after it was opened.
    await fs.writeFile(documentPath, threePageDocument());
    await fs.utimes(documentPath, new Date(), new Date(Date.now() + 5000));

    await expect(editor.save({ sessionId: SESSION_ID, mode: 'save' })).rejects.toMatchObject({
      code: 'io/changed-externally',
    });

    const forced = await editor.save({ sessionId: SESSION_ID, mode: 'save', force: true });
    expect(forced.canceled).toBe(false);
    expect(await readBack(documentPath)).toEqual({ pages: 3, rotations: [90, 0, 0] });
  });

  it('sends a read-only file to Save a Copy instead of failing late', async () => {
    const session = await makeSession(documentPath);
    const documents = makeDocuments({
      ...session,
      file: { ...session.file, readOnly: true },
    });
    const { editor } = makeEditor(documents);
    await editor.apply(SESSION_ID, rotate(1));

    await expect(editor.save({ sessionId: SESSION_ID, mode: 'save' })).rejects.toMatchObject({
      code: 'io/permission-denied',
    });
  });

  it('refuses to change an encrypted document rather than mangling it', async () => {
    const encrypted: PdfMutationEngine = {
      inspect: () => Promise.resolve({ pageCount: 0, encrypted: true }),
      apply: () =>
        Promise.reject(new AppError('internal/unexpected', { message: 'never reached' })),
      readAnnotations: () => Promise.resolve([]),
      ...READ_ONLY_STUBS,
    };
    const documents = makeDocuments(await makeSession(documentPath));
    const { editor } = makeEditor(documents, { engine: encrypted });

    await expect(editor.apply(SESSION_ID, rotate(1))).rejects.toMatchObject({
      code: 'pdf/unsupported-encryption',
    });
    expect(editor.currentBytesPath(SESSION_ID)).toBeUndefined();
  });

  it('checks a saved file with qpdf when qpdf is installed', async () => {
    const { qpdf, check } = fakeQpdf({ ok: true, readable: true, output: 'checks out' });
    const documents = makeDocuments(await makeSession(documentPath));
    const { editor } = makeEditor(documents, { qpdf });

    await editor.apply(SESSION_ID, rotate(1));
    const outcome = await editor.save({ sessionId: SESSION_ID, mode: 'save' });

    expect(outcome.checkedWithQpdf).toBe(true);
    // It checked the temporary file, before it replaced the destination.
    expect(check).toHaveBeenCalledTimes(1);
    expect(check.mock.calls[0]?.[0]).not.toBe(documentPath);
  });

  it('does not publish a file qpdf cannot read', async () => {
    const { qpdf } = fakeQpdf({ ok: false, readable: false, output: 'damaged xref' });
    const documents = makeDocuments(await makeSession(documentPath));
    const { editor } = makeEditor(documents, { qpdf });
    const before = await fs.readFile(documentPath);

    await editor.apply(SESSION_ID, rotate(1));
    await expect(editor.save({ sessionId: SESSION_ID, mode: 'save' })).rejects.toMatchObject({
      code: 'io/write-failed',
    });
    expect(await fs.readFile(documentPath)).toEqual(before);
  });

  it('saves anyway when qpdf only has warnings', async () => {
    const { qpdf } = fakeQpdf({ ok: false, readable: true, output: 'warning: harmless' });
    const documents = makeDocuments(await makeSession(documentPath));
    const { editor } = makeEditor(documents, { qpdf });

    await editor.apply(SESSION_ID, rotate(1));
    const outcome = await editor.save({ sessionId: SESSION_ID, mode: 'save' });
    expect(outcome.checkedWithQpdf).toBe(true);
  });

  it('throws its working copies away when the document closes', async () => {
    const documents = makeDocuments(await makeSession(documentPath));
    const { editor } = makeEditor(documents);
    await editor.apply(SESSION_ID, rotate(1));
    const revisions = path.join(workspace, 'revisions');
    expect((await fs.readdir(revisions)).length).toBeGreaterThan(0);

    await editor.dispose(SESSION_ID);

    await expect(fs.stat(revisions)).rejects.toThrow();
    expect(editor.state(SESSION_ID)).toMatchObject({ revision: 0, dirty: false });
  });
});
