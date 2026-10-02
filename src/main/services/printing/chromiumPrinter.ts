import { BrowserWindow, session, type WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { AppError } from '@shared/errors/appError';
import type { Printer } from '@shared/schemas/print';
import type { Logger } from '../logging/logger';
import { readValue } from '../windows/registry';
import type { PrintDriver } from './printJobs';

const LOAD_TIMEOUT_MS = 60_000;

/**
 * Prints a laid-out document through Chromium, which hands it to Windows.
 *
 * The document is loaded in a hidden window of its own that can reach
 * nothing but the job's folder: its own empty session, no scripting and no
 * node. Silent jobs go straight to the chosen printer; otherwise Windows
 * shows its print dialog first.
 */
export function createChromiumPrintDriver(logger: Logger): PrintDriver {
  return async ({ documentPath, directory, options }) => {
    const folder = pathToFileURL(path.join(directory, path.sep)).href.toLowerCase();
    const printSession = session.fromPartition(`paperforge-printjob-${randomUUID()}`, {
      cache: false,
    });
    printSession.webRequest.onBeforeRequest((details, callback) => {
      const allowed = details.url.toLowerCase().startsWith(folder);
      if (!allowed) logger.warn('Blocked a request while printing.', details.url);
      callback({ cancel: !allowed });
    });
    printSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));

    const window = new BrowserWindow({
      show: false,
      webPreferences: {
        session: printSession,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        javascript: false,
        webSecurity: true,
      },
    });

    try {
      await withTimeout(window.loadFile(documentPath), LOAD_TIMEOUT_MS);
      return await print(window.webContents, options);
    } finally {
      if (!window.isDestroyed()) window.destroy();
      await printSession.clearStorageData().catch(() => undefined);
    }
  };
}

function print(
  contents: WebContents,
  options: Electron.WebContentsPrintOptions,
): Promise<{ printed: boolean }> {
  return new Promise((resolve, reject) => {
    contents.print(options, (success, failureReason) => {
      if (success) {
        resolve({ printed: true });
        return;
      }
      // Dismissing the Windows print dialog is a choice, not a failure.
      if (/cancel/i.test(failureReason)) {
        resolve({ printed: false });
        return;
      }
      reject(
        new AppError('print/failed', {
          message: 'The printer did not accept the document.',
          details: failureReason,
        }),
      );
    });
  });
}

/** The printers Windows knows about, with the default first. */
export async function listPrinters(contents: WebContents): Promise<Printer[]> {
  const [printers, defaultName] = await Promise.all([
    contents.getPrintersAsync(),
    readDefaultPrinter(),
  ]);
  return printers
    .map((printer) => ({
      name: printer.name,
      displayName: printer.displayName === '' ? printer.name : printer.displayName,
      description: printer.description,
      isDefault: printer.name === defaultName,
    }))
    .sort((a, b) =>
      a.isDefault === b.isDefault
        ? a.displayName.localeCompare(b.displayName)
        : a.isDefault
          ? -1
          : 1,
    );
}

/**
 * Chromium no longer says which printer is the default, so it is read where
 * Windows keeps it: `Device` reads "Name,winspool,Ne00:".
 */
async function readDefaultPrinter(): Promise<string | null> {
  if (process.platform !== 'win32') return null;
  const device = await readValue(
    'HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Windows',
    'Device',
  ).catch(() => null);
  if (device === null) return null;
  const comma = device.lastIndexOf(',winspool');
  return comma > 0 ? device.slice(0, comma) : null;
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new AppError('print/failed', { details: 'The pages took too long to prepare.' }));
    }, ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
