import { dialog, type BrowserWindow } from 'electron';
import path from 'node:path';
import type { CreateOutcome } from '@shared/schemas/create';
import type { ConversionRegistry } from '@conversion/models/provider';
import type { DocumentCreator } from '../../services/creation/documentCreator';
import type { SourceLibrary } from '../../services/creation/sourceLibrary';
import type { RegisterInvoke } from '../registry';

export interface CreationHandlerDeps {
  library: SourceLibrary;
  creator: DocumentCreator;
  registry: ConversionRegistry;
  senderWindow: (event: Electron.IpcMainInvokeEvent) => BrowserWindow;
}

const CANCELED: CreateOutcome = { canceled: true, path: null, pageCount: 0 };
/** What a new document is called before the reader names it. */
const DEFAULT_NAMES = { blank: 'New document.pdf', combined: 'Combined.pdf' };

/**
 * Making new documents: staging the files one is made from, and writing the
 * result where the reader asks.
 *
 * Sources belong to the window that staged them, so two windows cannot see
 * each other's files, and a window's list goes when it closes.
 */
export function registerCreationHandlers(
  registerInvoke: RegisterInvoke,
  deps: CreationHandlerDeps,
): void {
  const ownerOf = (event: Electron.IpcMainInvokeEvent): number => event.sender.id;

  registerInvoke('sources:add', async ({ setup }, event) => {
    const result = await dialog.showOpenDialog(deps.senderWindow(event), {
      title: 'Add files',
      buttonLabel: 'Add',
      properties: ['openFile', 'multiSelections'],
      filters: deps.registry.fileFilters(),
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { sources: [], failures: [], canceled: true };
    }
    return deps.library.add(ownerOf(event), result.filePaths, setup);
  });

  registerInvoke('sources:list', (_input, event) => deps.library.listFor(ownerOf(event)));

  registerInvoke('sources:remove', ({ ids }, event) => {
    deps.library.remove(ownerOf(event), ids);
    return deps.library.listFor(ownerOf(event));
  });

  registerInvoke('sources:clear', (_input, event) => {
    deps.library.clear(ownerOf(event));
    return deps.library.listFor(ownerOf(event));
  });

  registerInvoke('sources:setPageSetup', ({ setup }, event) =>
    deps.library.reconvert(ownerOf(event), setup),
  );

  registerInvoke('create:blank', async (request, event) => {
    const target = await askWhereToSave(deps, event, DEFAULT_NAMES.blank);
    if (target === null) return CANCELED;
    return deps.creator.blank(request, target);
  });

  registerInvoke('create:combine', async (request, event) => {
    const first = request.entries[0];
    const suggestion =
      first === undefined
        ? DEFAULT_NAMES.combined
        : suggestedName(deps.library.get(ownerOf(event), first.id)?.fileName);

    const target = await askWhereToSave(deps, event, suggestion);
    if (target === null) return CANCELED;
    return deps.creator.combine(ownerOf(event), request, target);
  });
}

/** The save dialog every creation goes through; null when it was dismissed. */
async function askWhereToSave(
  deps: CreationHandlerDeps,
  event: Electron.IpcMainInvokeEvent,
  suggestion: string,
): Promise<string | null> {
  const result = await dialog.showSaveDialog(deps.senderWindow(event), {
    title: 'Save the new document',
    buttonLabel: 'Save',
    defaultPath: suggestion,
    filters: [{ name: 'PDF documents', extensions: ['pdf'] }],
    properties: ['createDirectory', 'showOverwriteConfirmation'],
  });
  return result.canceled || result.filePath === undefined ? null : result.filePath;
}

/** "Report.docx" suggests "Report combined.pdf". */
function suggestedName(fileName: string | undefined): string {
  if (fileName === undefined) return DEFAULT_NAMES.combined;
  const stem = path.basename(fileName, path.extname(fileName)).trim();
  return stem === '' ? DEFAULT_NAMES.combined : `${stem} combined.pdf`;
}
