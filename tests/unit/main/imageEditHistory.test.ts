import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import type { DocumentSession } from '../../../src/shared/schemas/document';
import { DEFAULT_ANNOTATION_STYLE } from '../../../src/shared/schemas/annotation';
import type { EditTransaction } from '../../../src/shared/schemas/edit';
import {
  DocumentEditor,
  type EditorDocuments,
} from '../../../src/main/services/documents/documentEditor';
import { PdfLibMutationEngine } from '../../../src/pdf/mutate/pdfLibEngine';
import { imageIdOf, readPageWithImages } from '../../../src/pdf/mutate/images';
import type { StagedAsset } from '../../../src/pdf/mutate/types';
import type { QpdfService } from '../../../src/main/services/qpdf/qpdfService';
import { buildPdf } from '../../fixtures/pdf';
import { pngPixel } from '../../fixtures/images';

/**
 * Every image and stamp change, one undo each, and what is saved.
 *
 * The changes go through the editor the application uses, so each one is a
 * revision: undo steps back through them in order, redo steps forward again,
 * and Save a Copy writes the revision being shown.
 */

const SESSION_ID = 'session-1';
const engine = new PdfLibMutationEngine();
const assets = new Map<string, StagedAsset>([
  ['pasted', { kind: 'image', bytes: pngPixel(20, 10), format: 'png', width: 20, height: 10 }],
  ['cut', { kind: 'image', bytes: pngPixel(10, 10), format: 'png', width: 10, height: 10 }],
]);

let sandbox = '';
let documentPath = '';

function makeEditor(session: DocumentSession): DocumentEditor {
  const state = { session };
  const documents: EditorDocuments = {
    get: () => state.session,
    retarget: () => Promise.resolve(state.session),
    markSavedByUs: () => Promise.resolve(state.session),
  };
  return new DocumentEditor({
    documents,
    engine,
    qpdf: { check: () => Promise.resolve(undefined) } as unknown as QpdfService,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    workspaceDirectory: () => path.join(sandbox, 'session'),
    recordState: () => Promise.resolve(),
    stagedAssets: () => assets,
  });
}

/** What the page draws and carries, in the terms the steps change. */
async function snapshot(bytes: Uint8Array): Promise<string> {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  const page = await readPageWithImages(document, 0);
  const images = page.images.map((image) => ({
    id: imageIdOf(image),
    x: Math.round(image.bounds.x),
    width: Math.round(image.bounds.width),
    rotation: Math.round(image.rotation),
    crop: image.crop === null ? null : Math.round(image.crop.width * 100),
    pixels: image.facts.width,
  }));
  const annotations = (await engine.readAnnotations(bytes)).map((annotation) => ({
    id: annotation.id,
    rotation: Math.round(annotation.rotation ?? 0),
  }));
  return JSON.stringify({ images, annotations });
}

const box = { x: 100, y: 400, width: 200, height: 100, rotation: 0, flipX: false, flipY: false };

beforeEach(async () => {
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'paperforge-images-'));
  await fs.mkdir(path.join(sandbox, 'session'), { recursive: true });
  documentPath = path.join(sandbox, 'Pictures.pdf');
  await fs.writeFile(documentPath, buildPdf({ pages: [{ text: 'A page' }] }));
});

afterEach(async () => {
  await fs.rm(sandbox, { recursive: true, force: true });
});

describe('image and stamp changes', () => {
  it('are each one undo, come back with redo, and are what is saved', async () => {
    const stats = await fs.stat(documentPath);
    const editor = makeEditor({
      id: SESSION_ID,
      documentId: 'doc-1',
      file: {
        path: documentPath,
        displayName: 'Pictures.pdf',
        sizeBytes: stats.size,
        modifiedAt: new Date(stats.mtimeMs).toISOString(),
        readOnly: false,
        pdfVersion: '1.7',
        encryptionDetected: false,
      },
      openedAt: new Date().toISOString(),
      dirty: false,
    });

    const place = (changes: Partial<typeof box>, extra: object = {}): EditTransaction => ({
      label: 'Change image',
      operations: [
        {
          kind: 'placeImage',
          page: 1,
          imageId: 'pf-pasted',
          placement: { ...box, ...changes },
          crop: null,
          opacity: 1,
          token: null,
          ...extra,
        },
      ],
    });

    const steps: EditTransaction[] = [
      {
        label: 'Paste image',
        operations: [
          {
            kind: 'addImage',
            page: 1,
            token: 'pasted',
            placement: box,
            opacity: 1,
            imageId: 'pf-pasted',
          },
        ],
      },
      place({ rotation: 30 }),
      place({ rotation: 30 }, { crop: { x: 0.25, y: 0, width: 0.5, height: 1 } }),
      place({ x: 150, width: 100, rotation: 30 }, { token: 'cut' }),
      place({ x: 160, width: 100, rotation: 30 }),
      {
        label: 'Add stamp',
        operations: [
          {
            kind: 'addAnnotations',
            annotations: [
              {
                pageNumber: 1,
                geometry: { kind: 'stamp', rect: { x: 50, y: 600, width: 120, height: 40 } },
                style: DEFAULT_ANNOTATION_STYLE,
                contents: '',
                author: 'Tester',
                subject: '',
                stampLabel: 'Approved',
              },
            ],
          },
        ],
      },
    ];

    const snapshots = [await snapshot(await editor.currentBytes(SESSION_ID))];
    for (const step of steps) {
      await editor.apply(SESSION_ID, step);
      snapshots.push(await snapshot(await editor.currentBytes(SESSION_ID)));
    }

    // The stamp's id is only known once it is written; turn and copy it.
    const [stamp] = await engine.readAnnotations(await editor.currentBytes(SESSION_ID));
    for (const step of [
      {
        label: 'Rotate stamp',
        operations: [
          { kind: 'updateAnnotations', updates: [{ id: stamp!.id, patch: { rotation: 45 } }] },
        ],
      },
      {
        label: 'Duplicate stamp',
        operations: [
          {
            kind: 'duplicateAnnotations',
            copies: [{ id: stamp!.id, newId: 'pf-copy' }],
            dx: 12,
            dy: -12,
          },
        ],
      },
    ] satisfies EditTransaction[]) {
      await editor.apply(SESSION_ID, step);
      snapshots.push(await snapshot(await editor.currentBytes(SESSION_ID)));
    }

    // Every step changed something.
    expect(new Set(snapshots).size).toBe(snapshots.length);
    const last = JSON.parse(snapshots.at(-1) ?? '{}') as {
      images: { id: string; rotation: number; pixels: number; crop: number | null }[];
      annotations: { id: string; rotation: number }[];
    };
    expect(last.images).toEqual([
      {
        id: 'pf-pasted',
        x: expect.any(Number) as number,
        width: expect.any(Number) as number,
        rotation: 30,
        crop: null,
        pixels: 10,
      },
    ]);
    expect(last.annotations.map((annotation) => annotation.rotation)).toEqual([45, 45]);

    // Undo walks back through every step, in order.
    for (let index = snapshots.length - 2; index >= 0; index -= 1) {
      await editor.undo(SESSION_ID);
      expect(await snapshot(await editor.currentBytes(SESSION_ID))).toBe(snapshots[index]);
    }
    // And redo forward again.
    for (let index = 1; index < snapshots.length; index += 1) {
      await editor.redo(SESSION_ID);
      expect(await snapshot(await editor.currentBytes(SESSION_ID))).toBe(snapshots[index]);
    }

    // What is saved is what is shown.
    const copy = path.join(sandbox, 'Saved copy.pdf');
    await editor.save({ sessionId: SESSION_ID, mode: 'saveCopy', destination: copy });
    expect(await snapshot(new Uint8Array(await fs.readFile(copy)))).toBe(snapshots.at(-1));
  });
});
