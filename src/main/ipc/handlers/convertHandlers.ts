import { dialog, type BrowserWindow } from 'electron';
import path from 'node:path';
import { AppError } from '@shared/errors/appError';
import type { ExportResult } from '@shared/schemas/pages';
import type { ExportMode } from '@shared/schemas/convert';
import type { DocumentService } from '../../services/documents/documentService';
import type { ExportSessions } from '../../services/conversion/exportSession';
import type { LibreOfficeProvider } from '../../services/conversion/libreOffice';
import type { SettingsStore } from '../../services/settings/settingsStore';
import type { RegisterInvoke } from '../registry';

export interface ConvertHandlerDeps {
  documents: DocumentService;
  exports: ExportSessions;
  office: LibreOfficeProvider;
  settings: SettingsStore;
  senderWindow: (event: Electron.IpcMainInvokeEvent) => BrowserWindow;
}

const CANCELED: ExportResult = { canceled: true, paths: [], directory: null };

/** What a mode's single file is called in the save dialog. */
const FILTERS: Record<ExportMode, { name: string; extensions: string[] } | null> = {
  png: null,
  jpeg: null,
  webp: null,
  txt: { name: 'Text files', extensions: ['txt'] },
  html: { name: 'Web pages', extensions: ['html'] },
  docx: { name: 'Word documents', extensions: ['docx'] },
  xlsx: { name: 'Workbooks', extensions: ['xlsx'] },
  pptx: { name: 'Presentations', extensions: ['pptx'] },
};

/**
 * Exporting a document to something that is not a PDF.
 *
 * The window renders and reads each page, because that is where PDF.js is,
 * and sends them here one at a time; this process writes the files. Where the
 * export is a single file the reader chooses it first, so a cancelled dialog
 * costs nothing.
 */
export function registerConvertHandlers(
  registerInvoke: RegisterInvoke,
  deps: ConvertHandlerDeps,
): void {
  registerInvoke('convert:start', async ({ sessionId, options }, event) => {
    const session = deps.documents.get(sessionId);
    if (session === undefined) {
      throw new AppError('internal/unexpected', { message: 'That document is no longer open.' });
    }

    const documentName = path.basename(
      session.file.displayName,
      path.extname(session.file.displayName),
    );
    const filter = FILTERS[options.mode];

    // Pictures go into a folder; everything else is one file with a name.
    if (filter === null) {
      const chosen = await dialog.showOpenDialog(deps.senderWindow(event), {
        title: 'Choose a folder for the pictures',
        buttonLabel: 'Export here',
        defaultPath: path.dirname(session.file.path),
        properties: ['openDirectory', 'createDirectory'],
      });
      const directory = chosen.canceled ? undefined : chosen.filePaths[0];
      if (directory === undefined) return { exportId: null };

      return { exportId: deps.exports.start({ directory, documentName, options }).id };
    }

    const chosen = await dialog.showSaveDialog(deps.senderWindow(event), {
      title: 'Export as',
      buttonLabel: 'Export',
      defaultPath: path.join(
        path.dirname(session.file.path),
        `${documentName}.${filter.extensions[0] ?? 'txt'}`,
      ),
      filters: [filter],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    if (chosen.canceled || chosen.filePath === undefined) return { exportId: null };

    return {
      exportId: deps.exports.start({
        directory: path.dirname(chosen.filePath),
        // The name the reader typed is the name the file gets.
        documentName: path.basename(chosen.filePath, path.extname(chosen.filePath)),
        options,
      }).id,
    };
  });

  registerInvoke('convert:page', async (payload) => {
    await deps.exports.get(payload.exportId).addPage(payload);
    return null;
  });

  registerInvoke('convert:finish', ({ exportId }) => deps.exports.finish(exportId));

  registerInvoke('convert:officeStatus', () => deps.office.status());

  registerInvoke('convert:locateOffice', async ({ clear }, event) => {
    if (clear === true) {
      await deps.settings.patch({ tools: { libreOfficePath: null } });
      deps.office.setConfiguredPath(null);
      return deps.office.status();
    }

    const result = await dialog.showOpenDialog(deps.senderWindow(event), {
      title: 'Where is LibreOffice?',
      buttonLabel: 'Use this program',
      properties: ['openFile'],
      filters: [{ name: 'Programs', extensions: ['exe'] }],
    });

    const chosen = result.canceled ? undefined : result.filePaths[0];
    if (chosen === undefined) return deps.office.status();

    await deps.settings.patch({ tools: { libreOfficePath: chosen } });
    deps.office.setConfiguredPath(chosen);
    return deps.office.status();
  });

  registerInvoke('convert:cancel', ({ exportId }) => {
    const result = deps.exports.cancel(exportId);
    return result.paths.length === 0 ? CANCELED : result;
  });
}
