import { dialog, type BrowserWindow } from 'electron';
import path from 'node:path';
import type { SaveMode, SaveOutcome } from '@shared/schemas/edit';
import type { DocumentEditor } from '../../services/documents/documentEditor';
import type { DocumentService } from '../../services/documents/documentService';
import type { QpdfService } from '../../services/qpdf/qpdfService';
import type { StagedAssets } from '../../services/documents/stagedAssets';
import type { SettingsStore } from '../../services/settings/settingsStore';
import type { RegisterInvoke } from '../registry';

export interface EditHandlerDeps {
  documents: DocumentService;
  editor: DocumentEditor;
  qpdf: QpdfService;
  stagedAssets: StagedAssets;
  settings: SettingsStore;
  senderWindow: (event: Electron.IpcMainInvokeEvent) => BrowserWindow;
}

const CANCELED: SaveOutcome = {
  canceled: true,
  session: null,
  edit: null,
  path: null,
  checkedWithQpdf: false,
};

/** Changing a document, taking those changes back, and writing them out. */
export function registerEditHandlers(registerInvoke: RegisterInvoke, deps: EditHandlerDeps): void {
  registerInvoke('edit:state', ({ sessionId }) => deps.editor.state(sessionId));
  registerInvoke('edit:apply', ({ sessionId, transaction }) =>
    deps.editor.apply(sessionId, transaction),
  );
  registerInvoke('edit:undo', ({ sessionId }) => deps.editor.undo(sessionId));
  registerInvoke('edit:redo', ({ sessionId }) => deps.editor.redo(sessionId));
  registerInvoke('edit:revert', ({ sessionId }) => deps.editor.revert(sessionId));

  registerInvoke('files:save', async ({ sessionId, mode, force }, event) => {
    // Save As and Save a Copy ask where to write. The dialog is a native
    // Windows one, so the renderer never handles a path.
    const destination =
      mode === 'save' ? undefined : await askWhereToWrite(deps, sessionId, mode, event);
    if (mode !== 'save' && destination === undefined) return CANCELED;

    return deps.editor.save({
      sessionId,
      mode,
      ...(destination === undefined ? {} : { destination }),
      ...(force === undefined ? {} : { force }),
    });
  });

  registerInvoke('annotations:list', ({ sessionId }) => deps.editor.annotations(sessionId));

  /**
   * Stages an image for stamping. The picker is native and the bytes stay
   * here; the renderer is handed a token and the size to place it at.
   */
  registerInvoke('annotations:stageStampImage', async ({ sessionId }, event) => {
    const result = await dialog.showOpenDialog(deps.senderWindow(event), {
      title: 'Choose an image to stamp',
      buttonLabel: 'Use image',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }],
    });

    const chosen = result.canceled ? undefined : result.filePaths[0];
    if (chosen === undefined) return null;
    return deps.stagedAssets.stageImage(sessionId, chosen);
  });

  registerInvoke('tools:qpdfStatus', () => deps.qpdf.status());

  /**
   * Points PaperForge at a qpdf executable, or forgets the one it was given
   * and looks in the usual places again. The picker is native, so the renderer
   * never handles a path.
   */
  registerInvoke('tools:locateQpdf', async ({ clear }, event) => {
    if (clear === true) {
      await deps.settings.patch({ tools: { qpdfPath: null } });
      return deps.qpdf.status();
    }

    const result = await dialog.showOpenDialog(deps.senderWindow(event), {
      title: 'Locate qpdf',
      buttonLabel: 'Use this',
      properties: ['openFile'],
      filters:
        process.platform === 'win32'
          ? [{ name: 'Programs', extensions: ['exe'] }]
          : [{ name: 'All files', extensions: ['*'] }],
    });

    const chosen = result.canceled ? undefined : result.filePaths[0];
    if (chosen === undefined) return deps.qpdf.status();

    await deps.settings.patch({ tools: { qpdfPath: chosen } });
    return deps.qpdf.status();
  });
}

async function askWhereToWrite(
  deps: EditHandlerDeps,
  sessionId: string,
  mode: SaveMode,
  event: Electron.IpcMainInvokeEvent,
): Promise<string | undefined> {
  const session = deps.documents.get(sessionId);
  const current = session?.file.path ?? '';
  const suggestion =
    mode === 'saveCopy' && current !== ''
      ? path.join(
          path.dirname(current),
          `${path.basename(current, path.extname(current))} copy${path.extname(current) || '.pdf'}`,
        )
      : current;

  const result = await dialog.showSaveDialog(deps.senderWindow(event), {
    title: mode === 'saveCopy' ? 'Save a Copy' : 'Save As',
    buttonLabel: 'Save',
    defaultPath: suggestion,
    filters: [{ name: 'PDF documents', extensions: ['pdf'] }],
    properties: ['createDirectory', 'showOverwriteConfirmation'],
  });

  if (result.canceled || result.filePath === undefined || result.filePath === '') return undefined;
  return result.filePath;
}
