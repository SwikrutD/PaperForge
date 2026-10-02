import { dialog, type BrowserWindow } from 'electron';
import path from 'node:path';
import type { RepairOutcome } from '@shared/schemas/repair';
import type { DocumentRepair } from '../../services/documents/documentRepair';
import type { DocumentService } from '../../services/documents/documentService';
import type { RegisterInvoke } from '../registry';

export interface RepairHandlerDeps {
  documents: DocumentService;
  repair: DocumentRepair;
  senderWindow: (event: Electron.IpcMainInvokeEvent) => BrowserWindow;
}

const CANCELED: RepairOutcome = {
  canceled: true,
  path: null,
  method: null,
  pageCount: 0,
  messages: [],
};

/**
 * Checking a document and writing a repaired copy. The copy goes where the
 * reader chooses in a native dialog, suggested beside the original under a
 * name of its own.
 */
export function registerRepairHandlers(
  registerInvoke: RegisterInvoke,
  deps: RepairHandlerDeps,
): void {
  registerInvoke('repair:diagnose', ({ sessionId }) => deps.repair.diagnose(sessionId));

  registerInvoke('repair:save', async ({ sessionId }, event) => {
    const session = deps.documents.get(sessionId);
    if (session === undefined) return CANCELED;

    const original = session.file.path;
    const result = await dialog.showSaveDialog(deps.senderWindow(event), {
      title: 'Save repaired copy',
      buttonLabel: 'Save',
      defaultPath: path.join(
        path.dirname(original),
        `${path.basename(original, path.extname(original))} repaired.pdf`,
      ),
      filters: [{ name: 'PDF document', extensions: ['pdf'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    if (result.canceled || result.filePath === undefined || result.filePath === '') return CANCELED;

    return deps.repair.repair(sessionId, original, result.filePath);
  });
}
