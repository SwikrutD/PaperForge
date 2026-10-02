import { app, Notification, shell, type BrowserWindow } from 'electron';
import { existsSync } from 'node:fs';
import { APP_NAME } from '@shared/constants/app';
import type { RecentFileEntry } from '@shared/schemas/recentFiles';
import type {
  FileAssociationStatus,
  NotificationRequest,
  TaskbarProgress,
} from '@shared/schemas/system';
import type { Logger } from '../logging/logger';
import {
  readAssociation,
  registerFileAssociation,
  unregisterFileAssociation,
} from './fileAssociation';
import { buildJumpList, stableExecutable } from './jumpList';

export interface DesktopIntegrationOptions {
  logger: Logger;
  /** Read when a notification is about to be shown. */
  notificationsEnabled: () => boolean;
}

/**
 * The parts of PaperForge that belong to Windows rather than to a document:
 * files handed over by Explorer, the jump list, the taskbar button, and
 * notifications.
 *
 * Only an installed (packaged) copy on Windows touches the registry or the
 * jump list. A development build runs as electron.exe, and pointing Windows
 * at that would break the reader's PDF files once the build is gone.
 */
export class DesktopIntegration {
  private pending: string[] = [];
  /** Kept until dismissed, or Windows may drop a notification's click. */
  private readonly shown = new Set<Notification>();
  readonly executable: string;
  readonly supported: boolean;

  constructor(private readonly options: DesktopIntegrationOptions) {
    this.supported = app.isPackaged && process.platform === 'win32';
    this.executable = stableExecutable(process.execPath, existsSync);
  }

  /** Files waiting for a window to open them. */
  queue(paths: readonly string[]): void {
    for (const candidate of paths) {
      const known = this.pending.some((entry) => entry.toLowerCase() === candidate.toLowerCase());
      if (!known) this.pending.push(candidate);
    }
  }

  take(): string[] {
    const paths = this.pending;
    this.pending = [];
    return paths;
  }

  async fileAssociation(): Promise<FileAssociationStatus> {
    if (!this.supported) {
      return {
        supported: false,
        openWith: false,
        isDefault: false,
        problem:
          process.platform === 'win32'
            ? 'This is a development build. Install PaperForge to offer it for PDF files.'
            : 'File associations are only offered on Windows.',
      };
    }
    try {
      return { supported: true, problem: null, ...(await readAssociation(this.executable)) };
    } catch (error) {
      this.options.logger.warn('Could not read the PDF file association.', error);
      return {
        supported: true,
        openWith: false,
        isDefault: false,
        problem: 'Windows did not say whether PaperForge is offered for PDF files.',
      };
    }
  }

  async setOpenWith(enabled: boolean): Promise<FileAssociationStatus> {
    if (this.supported) {
      if (enabled) {
        const written = await registerFileAssociation(this.executable);
        if (!written) this.options.logger.warn('Part of the PDF file association was not written.');
      } else {
        await unregisterFileAssociation(this.executable);
      }
    }
    return this.fileAssociation();
  }

  /** Windows Settings, at the page where PaperForge can be made the default. */
  async openDefaultApps(): Promise<void> {
    await shell.openExternal(`ms-settings:defaultapps?registeredAppUser=${APP_NAME}`);
  }

  updateJumpList(entries: readonly RecentFileEntry[]): void {
    if (!this.supported) return;
    try {
      const result = app.setJumpList(buildJumpList(entries, this.executable));
      if (result !== 'ok')
        this.options.logger.warn('Windows did not accept the jump list.', result);
    } catch (error) {
      this.options.logger.warn('Could not update the jump list.', error);
    }
  }

  setProgress(window: BrowserWindow, progress: TaskbarProgress): void {
    if (window.isDestroyed()) return;
    window.setProgressBar(progress.state === 'none' ? -1 : progress.value, {
      mode: progress.state,
    });
  }

  /** Shows a notification, unless the reader is already looking at PaperForge. */
  notify(window: BrowserWindow, request: NotificationRequest): void {
    if (window.isDestroyed() || window.isFocused()) return;
    if (!this.options.notificationsEnabled() || !Notification.isSupported()) return;

    const notification = new Notification({ title: request.title, body: request.body });
    const release = (): void => {
      this.shown.delete(notification);
    };
    notification.on('click', () => {
      release();
      if (window.isDestroyed()) return;
      if (window.isMinimized()) window.restore();
      window.focus();
    });
    notification.on('close', release);
    notification.on('failed', release);
    this.shown.add(notification);
    notification.show();
  }
}
