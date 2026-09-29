import { dialog, type BrowserWindow } from 'electron';
import path from 'node:path';
import type { SaveAttachmentOutcome } from '@shared/schemas/attachment';
import type { ProtectOutcome } from '@shared/schemas/protect';
import type { DocumentAdmin } from '../../services/documents/documentAdmin';
import type { DocumentService } from '../../services/documents/documentService';
import type { RegisterInvoke } from '../registry';

export interface AdminHandlerDeps {
  documents: DocumentService;
  admin: DocumentAdmin;
  senderWindow: (event: Electron.IpcMainInvokeEvent) => BrowserWindow;
}

const CANCELED_SAVE: SaveAttachmentOutcome = { canceled: true, path: null };
const CANCELED_PROTECT: ProtectOutcome = { canceled: true, path: null };

/**
 * Document administration: properties, attachments, hidden information and
 * security.
 *
 * Every path the reader chooses comes from a native Windows dialog opened
 * here, so the renderer never handles one. Passwords arrive on the protect
 * requests, are passed straight to the service and are not put in the reply,
 * in a log line, or in the settings file.
 */
export function registerAdminHandlers(
  registerInvoke: RegisterInvoke,
  deps: AdminHandlerDeps,
): void {
  registerInvoke('document:properties', ({ sessionId }) => deps.admin.properties(sessionId));

  registerInvoke('sanitize:scan', ({ sessionId }) => deps.admin.scan(sessionId));

  registerInvoke('attachments:list', ({ sessionId }) => deps.admin.attachments(sessionId));

  registerInvoke('attachments:choose', async ({ sessionId }, event) => {
    const result = await dialog.showOpenDialog(deps.senderWindow(event), {
      title: 'Choose files to attach',
      buttonLabel: 'Attach',
      properties: ['openFile', 'multiSelections'],
    });
    if (result.canceled) return [];

    const staged = [];
    for (const filePath of result.filePaths) {
      staged.push(await deps.admin.stageAttachment(sessionId, filePath));
    }
    return staged;
  });

  registerInvoke('attachments:save', async ({ sessionId, id }, event) => {
    const attachments = await deps.admin.attachments(sessionId);
    const attachment = attachments.find((entry) => entry.id === id);
    if (attachment === undefined) return CANCELED_SAVE;

    const result = await dialog.showSaveDialog(deps.senderWindow(event), {
      title: 'Save attachment',
      buttonLabel: 'Save',
      defaultPath: attachment.fileName,
      ...filtersFor(attachment.fileName),
    });

    const destination = result.canceled ? undefined : result.filePath;
    if (destination === undefined || destination === '') return CANCELED_SAVE;

    await deps.admin.saveAttachment(sessionId, id, destination);
    return { canceled: false, path: destination };
  });

  registerInvoke('protect:apply', async (request, event) => {
    const destination = await askWhereToWrite(deps, request.sessionId, 'protected', event);
    if (destination === undefined) return CANCELED_PROTECT;

    await deps.admin.protect(request.sessionId, request, destination);
    return { canceled: false, path: destination };
  });

  registerInvoke('protect:remove', async ({ sessionId, password }, event) => {
    const destination = await askWhereToWrite(deps, sessionId, 'unprotected', event);
    if (destination === undefined) return CANCELED_PROTECT;

    await deps.admin.unprotect(sessionId, password, destination);
    return { canceled: false, path: destination };
  });
}

/**
 * Where the new document goes.
 *
 * Both security operations write a copy: the one that is open stays as it is,
 * so a reader who protects a document still has the editable original in front
 * of them.
 */
async function askWhereToWrite(
  deps: AdminHandlerDeps,
  sessionId: string,
  suffix: string,
  event: Electron.IpcMainInvokeEvent,
): Promise<string | undefined> {
  const session = deps.documents.get(sessionId);
  const current = session?.file.path ?? '';
  const suggestion =
    current === ''
      ? `${suffix}.pdf`
      : path.join(
          path.dirname(current),
          `${path.basename(current, path.extname(current))} ${suffix}.pdf`,
        );

  const result = await dialog.showSaveDialog(deps.senderWindow(event), {
    title: suffix === 'protected' ? 'Save protected copy' : 'Save unprotected copy',
    buttonLabel: 'Save',
    defaultPath: suggestion,
    filters: [{ name: 'PDF document', extensions: ['pdf'] }],
  });

  if (result.canceled || result.filePath === '') return undefined;
  return result.filePath;
}

/** A filter for the attachment's own kind, so Explorer suggests the right name. */
function filtersFor(fileName: string): { filters?: Electron.FileFilter[] } {
  const extension = path.extname(fileName).replace(/^\./, '').toLowerCase();
  if (extension === '') return {};
  return {
    filters: [
      { name: `${extension.toUpperCase()} file`, extensions: [extension] },
      { name: 'All files', extensions: ['*'] },
    ],
  };
}
