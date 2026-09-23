import { BrowserWindow, session } from 'electron';
import { randomUUID } from 'node:crypto';
import { AppError } from '@shared/errors/appError';
import type { PageSetup } from '@shared/schemas/create';
import type { ConversionProvider, SourceInput } from '@conversion/models/provider';
import { resolveSize } from '@pdf/create/paper';
import type { Logger } from '../logging/logger';

/**
 * Web pages, printed to PDF by Chromium itself.
 *
 * The page is loaded in a window of its own that can reach nothing: its own
 * empty session, no scripting, no node, and every request that is not the
 * local file itself refused. A local HTML file is as untrusted as a PDF, and
 * PaperForge will not let one phone home while being converted.
 */

const LOAD_TIMEOUT_MS = 20_000;
/** A page is measured in inches by Chromium's printing. */
const POINTS_PER_INCH = 72;

export function createHtmlProvider(logger: Logger): ConversionProvider {
  return {
    id: 'html',
    label: 'Web pages',
    extensions: ['html', 'htm'],
    availability: () => Promise.resolve(null),
    toPdf: (input: SourceInput, setup: PageSetup) => printToPdf(input, setup, logger),
  };
}

async function printToPdf(
  input: SourceInput,
  setup: PageSetup,
  logger: Logger,
): Promise<Uint8Array> {
  const printSession = session.fromPartition(`paperforge-print-${randomUUID()}`, { cache: false });
  // Nothing but the file being printed and whatever sits beside it on disk.
  printSession.webRequest.onBeforeRequest((details, callback) => {
    const allowed = details.url.startsWith('file://') || details.url.startsWith('devtools://');
    if (!allowed) logger.warn('Blocked a request while converting a web page.', details.url);
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
      // A local web page is untrusted content: it is converted, never run.
      javascript: false,
      webSecurity: true,
    },
  });

  try {
    await withTimeout(
      window.loadFile(input.path),
      LOAD_TIMEOUT_MS,
      `${input.fileName} took too long to load.`,
    );

    const page = resolveSize(setup.size) ?? { width: 595.28, height: 841.89 };
    const margin = setup.margin / POINTS_PER_INCH;
    const data = await window.webContents.printToPDF({
      pageSize: { width: page.width / POINTS_PER_INCH, height: page.height / POINTS_PER_INCH },
      margins: { top: margin, bottom: margin, left: margin, right: margin },
      printBackground: true,
    });
    return new Uint8Array(data);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('internal/unexpected', {
      message: `${input.fileName} could not be converted.`,
      details: error instanceof Error ? error.message : String(error),
      cause: error,
    });
  } finally {
    if (!window.isDestroyed()) window.destroy();
    await printSession.clearStorageData().catch(() => undefined);
  }
}

function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new AppError('internal/unexpected', { message }));
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
