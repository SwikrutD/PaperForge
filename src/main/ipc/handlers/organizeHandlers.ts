import { dialog, type BrowserWindow } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '@shared/errors/appError';
import type { ExportResult } from '@shared/schemas/pages';
import { readPageBoxes } from '@pdf/mutate/extract';
import type { PdfMutationEngine } from '@pdf/mutate/types';
import type { DocumentEditor } from '../../services/documents/documentEditor';
import type { DocumentService } from '../../services/documents/documentService';
import type { PageExport } from '../../services/documents/pageExport';
import type { StagedAssets } from '../../services/documents/stagedAssets';
import type { RegisterInvoke } from '../registry';

export interface OrganizeHandlerDeps {
  documents: DocumentService;
  editor: DocumentEditor;
  stagedAssets: StagedAssets;
  pageExport: PageExport;
  engine: PdfMutationEngine;
  senderWindow: (event: Electron.IpcMainInvokeEvent) => BrowserWindow;
}

const CANCELED: ExportResult = { canceled: true, paths: [], directory: null };

/** Page organisation: what a page is, where pages come from, where they go. */
export function registerOrganizeHandlers(
  registerInvoke: RegisterInvoke,
  deps: OrganizeHandlerDeps,
): void {
  registerInvoke('pages:boxes', async ({ sessionId }) => {
    const bytes = await deps.editor.currentBytes(sessionId);
    return readPageBoxes(bytes);
  });

  /**
   * Stages another PDF to take pages from. The picker is native and the bytes
   * stay here; the renderer is told how many pages are on offer.
   */
  registerInvoke('pages:choosePdfSource', async ({ sessionId }, event) => {
    const result = await dialog.showOpenDialog(deps.senderWindow(event), {
      title: 'Insert pages from',
      buttonLabel: 'Use this document',
      properties: ['openFile'],
      filters: [{ name: 'PDF documents', extensions: ['pdf'] }],
    });

    const chosen = result.canceled ? undefined : result.filePaths[0];
    if (chosen === undefined) return null;

    const bytes = new Uint8Array(await fs.readFile(chosen));
    const facts = await deps.engine.inspect(bytes);
    if (facts.encrypted || facts.pageCount < 1) {
      throw new AppError('pdf/unsupported-encryption', {
        message: 'PaperForge cannot take pages from that document.',
        details: facts.encrypted ? 'it is encrypted' : 'it has no pages',
      });
    }
    return deps.stagedAssets.stagePdf(sessionId, chosen, facts.pageCount);
  });

  /** Stages an image to put on a page of its own. */
  registerInvoke('pages:chooseImageSource', async ({ sessionId }, event) => {
    const result = await dialog.showOpenDialog(deps.senderWindow(event), {
      title: 'Insert an image as a page',
      buttonLabel: 'Use image',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }],
    });

    const chosen = result.canceled ? undefined : result.filePaths[0];
    if (chosen === undefined) return null;

    const image = await deps.stagedAssets.stageImage(sessionId, chosen);
    return {
      kind: 'image' as const,
      token: image.token,
      fileName: image.fileName,
      width: image.width,
      height: image.height,
    };
  });

  /**
   * Stages another open document, so pages can be moved between tabs without
   * either document being written to disk first.
   */
  registerInvoke('pages:stageOpenDocument', async ({ sessionId, fromSessionId }) => {
    const source = deps.documents.get(fromSessionId);
    if (source === undefined) {
      throw new AppError('internal/unexpected', {
        message: 'That document is no longer open.',
        details: `session ${fromSessionId}`,
      });
    }

    const bytes = await deps.editor.currentBytes(fromSessionId);
    const facts = await deps.engine.inspect(bytes);
    const token = deps.stagedAssets.stageBytes(sessionId, bytes, facts.pageCount);
    return {
      kind: 'pdf' as const,
      token,
      fileName: source.file.displayName,
      pageCount: facts.pageCount,
    };
  });

  registerInvoke('pages:extract', async ({ sessionId, parts, mode }, event) => {
    const session = deps.documents.get(sessionId);
    if (session === undefined) {
      throw new AppError('internal/unexpected', { message: 'That document is no longer open.' });
    }
    const bytes = await deps.editor.currentBytes(sessionId);

    if (mode === 'single') {
      const first = parts[0];
      if (first === undefined) return CANCELED;
      const result = await dialog.showSaveDialog(deps.senderWindow(event), {
        title: 'Save the extracted pages',
        buttonLabel: 'Save',
        defaultPath: path.join(path.dirname(session.file.path), first.name),
        filters: [{ name: 'PDF documents', extensions: ['pdf'] }],
        properties: ['createDirectory', 'showOverwriteConfirmation'],
      });
      if (result.canceled || result.filePath === undefined) return CANCELED;

      return deps.pageExport.run({
        bytes,
        sourceName: session.file.displayName,
        parts: [first],
        destination: { kind: 'file', path: result.filePath },
      });
    }

    const folder = await dialog.showOpenDialog(deps.senderWindow(event), {
      title: 'Choose a folder for the new documents',
      buttonLabel: 'Save here',
      defaultPath: path.dirname(session.file.path),
      properties: ['openDirectory', 'createDirectory'],
    });
    const directory = folder.canceled ? undefined : folder.filePaths[0];
    if (directory === undefined) return CANCELED;

    return deps.pageExport.run({
      bytes,
      sourceName: session.file.displayName,
      parts,
      destination: { kind: 'directory', path: directory },
    });
  });
}
