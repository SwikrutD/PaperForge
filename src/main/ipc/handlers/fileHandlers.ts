import { app, dialog, shell, type BrowserWindow } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { AppError } from '@shared/errors/appError';
import type { OpenResult } from '@shared/schemas/document';
import type { DocumentService } from '../../services/documents/documentService';
import type { RecentFilesStore } from '../../services/recentFiles/recentFilesStore';
import type { SettingsStore } from '../../services/settings/settingsStore';
import type { SessionRecovery } from '../../services/recovery/sessionRecovery';
import type { RegisterInvoke } from '../registry';

export interface FileHandlerDeps {
  documents: DocumentService;
  recentFiles: RecentFilesStore;
  settings: SettingsStore;
  recovery: SessionRecovery;
  senderWindow: (event: Electron.IpcMainInvokeEvent) => BrowserWindow;
}

const EMPTY_RESULT: OpenResult = { sessions: [], failures: [], canceled: false };

/** Schemes a document link may use. Anything else is refused outright. */
const ALLOWED_EXTERNAL_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

/** Opening, closing, restoring and recovering document sessions. */
export function registerFileHandlers(registerInvoke: RegisterInvoke, deps: FileHandlerDeps): void {
  registerInvoke('files:openDialog', async (_input, event) => {
    const result = await dialog.showOpenDialog(deps.senderWindow(event), {
      title: 'Open PDF',
      buttonLabel: 'Open',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'PDF documents', extensions: ['pdf'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { ...EMPTY_RESULT, canceled: true };
    }
    return deps.documents.openPaths(result.filePaths);
  });

  registerInvoke('files:openPaths', ({ paths }) => deps.documents.openPaths(paths));

  registerInvoke('files:list', () => deps.documents.list());

  registerInvoke('files:close', async ({ sessionId }) => {
    await deps.documents.close(sessionId);
  });

  registerInvoke('files:restoreSession', async () => {
    const { restoreOnStartup, openDocuments } = deps.settings.get().session;
    if (!restoreOnStartup || openDocuments.length === 0) return EMPTY_RESULT;
    // Restoring must not reorder the recent files list.
    return deps.documents.openPaths(openDocuments, { recordAsRecent: false });
  });

  registerInvoke('files:revealInExplorer', async ({ path: filePath }) => {
    try {
      await fs.access(filePath);
    } catch {
      throw new AppError('io/not-found', {
        message: 'That file is no longer there.',
        details: filePath,
      });
    }
    shell.showItemInFolder(filePath);
  });

  /**
   * Opens a link from a document in the system browser. The renderer has
   * already asked the user; this only lets through schemes that cannot run
   * anything locally.
   */
  registerInvoke('shell:openExternal', async ({ url }) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new AppError('internal/unexpected', {
        message: 'That link is not a valid address.',
        details: url.slice(0, 200),
      });
    }

    if (!ALLOWED_EXTERNAL_SCHEMES.has(parsed.protocol)) {
      throw new AppError('internal/unexpected', {
        message: `PaperForge does not open ${parsed.protocol} links.`,
        details: url.slice(0, 200),
      });
    }
    await shell.openExternal(parsed.toString());
  });

  registerInvoke('recentFiles:list', () => deps.recentFiles.list());
  registerInvoke('recentFiles:clear', () => deps.recentFiles.clear());
  registerInvoke('recentFiles:setPinned', ({ path: filePath, pinned }) =>
    deps.recentFiles.setPinned(filePath, pinned),
  );
  registerInvoke('recentFiles:remove', ({ path: filePath }) => deps.recentFiles.remove(filePath));

  registerInvoke('recovery:list', () => deps.recovery.list());

  registerInvoke('recovery:restore', ({ sessionIds }) => deps.recovery.restore(sessionIds));

  /** Unsaved changes whose file has gone are written wherever the reader chooses. */
  registerInvoke('recovery:saveCopy', async ({ sessionId, displayName }, event) => {
    const result = await dialog.showSaveDialog(deps.senderWindow(event), {
      title: 'Save recovered changes',
      buttonLabel: 'Save',
      defaultPath: path.join(app.getPath('documents'), recoveredName(displayName)),
      filters: [{ name: 'PDF documents', extensions: ['pdf'] }],
    });
    if (result.canceled || result.filePath === undefined || result.filePath === '') {
      return { ...EMPTY_RESULT, canceled: true };
    }
    return deps.recovery.saveCopy(sessionId, result.filePath);
  });

  registerInvoke('recovery:discard', ({ sessionIds }) => deps.recovery.discard(sessionIds));
}

/** "Report.pdf" becomes "Report (recovered).pdf". */
export function recoveredName(displayName: string): string {
  const base = displayName.replace(/\.pdf$/i, '');
  return `${base} (recovered).pdf`;
}
