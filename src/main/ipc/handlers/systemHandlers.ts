import type { BrowserWindow } from 'electron';
import type { DocumentService } from '../../services/documents/documentService';
import type { DesktopIntegration } from '../../services/windows/desktopIntegration';
import type { RegisterInvoke } from '../registry';

export interface SystemHandlerDeps {
  documents: DocumentService;
  desktop: DesktopIntegration;
  senderWindow: (event: Electron.IpcMainInvokeEvent) => BrowserWindow;
}

/** Windows integration: launch files, the taskbar, notifications, Open With. */
export function registerSystemHandlers(
  registerInvoke: RegisterInvoke,
  deps: SystemHandlerDeps,
): void {
  registerInvoke('files:openLaunchPaths', async () => {
    const paths = deps.desktop.take();
    if (paths.length === 0) return { sessions: [], failures: [], canceled: false };
    return deps.documents.openPaths(paths);
  });

  registerInvoke('window:setProgress', (progress, event) => {
    deps.desktop.setProgress(deps.senderWindow(event), progress);
    return null;
  });

  registerInvoke('window:notify', (request, event) => {
    deps.desktop.notify(deps.senderWindow(event), request);
    return null;
  });

  registerInvoke('system:fileAssociation', () => deps.desktop.fileAssociation());
  registerInvoke('system:setOpenWith', ({ enabled }) => deps.desktop.setOpenWith(enabled));
  registerInvoke('system:openDefaultApps', async () => {
    await deps.desktop.openDefaultApps();
    return null;
  });
}
