import { BrowserWindow } from 'electron';
import { eventContracts } from '@shared/ipc/contracts';
import type { DesktopIntegration } from '../services/windows/desktopIntegration';
import type { LaunchRequest } from '../services/windows/launchArgs';

export interface LaunchTarget {
  desktop: DesktopIntegration;
  openWindow: () => BrowserWindow;
}

/**
 * Carries files from Explorer, Open With and the jump list to a window.
 *
 * A launch can arrive before PaperForge is ready — the files it was started
 * with, or a second launch while it is still starting — so requests wait
 * here until there is somewhere to send them. The files themselves wait in
 * the desktop integration until a window asks for them, which it does once
 * it has started and whenever it is told more have arrived.
 */
export class LaunchRouter {
  private early: Array<{ request: LaunchRequest; initial: boolean }> = [];
  private target: LaunchTarget | null = null;

  receive(request: LaunchRequest, initial: boolean): void {
    if (this.target === null) {
      this.early.push({ request, initial });
      return;
    }
    route(this.target, request, initial);
  }

  attach(target: LaunchTarget): void {
    this.target = target;
    const early = this.early;
    this.early = [];
    for (const { request, initial } of early) route(target, request, initial);
  }
}

function route(target: LaunchTarget, request: LaunchRequest, initial: boolean): void {
  if (request.paths.length > 0) target.desktop.queue(request.paths);
  // The first launch opens its own window, which takes the files on start.
  if (initial) return;

  if (request.newWindow) {
    target.openWindow();
    return;
  }

  const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  if (window === undefined) {
    target.openWindow();
    return;
  }
  if (window.isMinimized()) window.restore();
  window.focus();

  if (request.paths.length > 0 && !window.webContents.isLoading()) {
    const payload = eventContracts['files:launchPathsWaiting'].parse({
      count: request.paths.length,
    });
    window.webContents.send('files:launchPathsWaiting', payload);
  }
}
