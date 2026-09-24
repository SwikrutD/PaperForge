import { dialog, type BrowserWindow } from 'electron';
import path from 'node:path';
import { AppError } from '@shared/errors/appError';
import type { ExportResult } from '@shared/schemas/pages';
import type { OcrPageResult } from '@shared/schemas/ocr';
import type { DocumentService } from '../../services/documents/documentService';
import type { SettingsStore } from '../../services/settings/settingsStore';
import type { TesseractService } from '../../services/tesseract/tesseractService';
import { writeFileAtomic } from '../../services/filesystem/atomicWrite';
import type { RegisterInvoke } from '../registry';

export interface OcrHandlerDeps {
  documents: DocumentService;
  settings: SettingsStore;
  tesseract: TesseractService;
  senderWindow: (event: Electron.IpcMainInvokeEvent) => BrowserWindow;
}

/** Notepad still reads UTF-8 better when the file starts with one. */
const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);

const CANCELED: ExportResult = { canceled: true, paths: [], directory: null };

/**
 * Recognising text, entirely on this computer.
 *
 * The window renders each page and sends the picture here; this process runs
 * the local Tesseract binary against local language data and sends back what
 * it read. Nothing is uploaded and nothing is downloaded — a run with no
 * network at all behaves exactly the same.
 */
export function registerOcrHandlers(registerInvoke: RegisterInvoke, deps: OcrHandlerDeps): void {
  /** One run at a time per window, so Cancel has something to stop. */
  const running = new Map<string, AbortController>();

  registerInvoke('ocr:status', () => deps.tesseract.status());

  registerInvoke('ocr:locate', async ({ clear }, event) => {
    if (clear === true) {
      await deps.settings.patch({ tools: { tesseractPath: null } });
      deps.tesseract.configure({ executable: null });
      return deps.tesseract.status();
    }

    const result = await dialog.showOpenDialog(deps.senderWindow(event), {
      title: 'Where is Tesseract?',
      buttonLabel: 'Use this program',
      properties: ['openFile'],
      filters: [{ name: 'Programs', extensions: ['exe'] }],
    });

    const chosen = result.canceled ? undefined : result.filePaths[0];
    if (chosen === undefined) return deps.tesseract.status();

    await deps.settings.patch({ tools: { tesseractPath: chosen } });
    deps.tesseract.configure({ executable: chosen });
    return deps.tesseract.status();
  });

  registerInvoke('ocr:locateLanguages', async ({ clear }, event) => {
    if (clear === true) {
      await deps.settings.patch({ tools: { tessdataPath: null } });
      deps.tesseract.configure({ tessdata: null });
      return deps.tesseract.status();
    }

    const result = await dialog.showOpenDialog(deps.senderWindow(event), {
      title: 'Where is the language data?',
      buttonLabel: 'Use this folder',
      properties: ['openDirectory'],
    });

    const chosen = result.canceled ? undefined : result.filePaths[0];
    if (chosen === undefined) return deps.tesseract.status();

    await deps.settings.patch({ tools: { tessdataPath: chosen } });
    deps.tesseract.configure({ tessdata: chosen });
    return deps.tesseract.status();
  });

  /** Reads one rendered page. The picture crosses as base64 and is not kept. */
  registerInvoke('ocr:recognisePage', async ({ sessionId, page, image, options }) => {
    const controller = new AbortController();
    running.get(sessionId)?.abort();
    running.set(sessionId, controller);

    try {
      const bytes = new Uint8Array(Buffer.from(image, 'base64'));
      const measured = sizeOfPng(bytes);
      if (measured === null) {
        throw new AppError('ocr/failed', {
          message: 'That page could not be read.',
          details: 'the rendered picture is not a PNG',
        });
      }

      const parsed = await deps.tesseract.recognise(bytes, options, controller.signal);
      const result: OcrPageResult = {
        page,
        words: parsed.words,
        text: parsed.text,
        imageWidth: measured.width,
        imageHeight: measured.height,
        confidence: parsed.confidence,
      };
      return result;
    } finally {
      if (running.get(sessionId) === controller) running.delete(sessionId);
    }
  });

  registerInvoke('ocr:cancel', ({ sessionId }) => {
    running.get(sessionId)?.abort();
    running.delete(sessionId);
    return null;
  });

  /** Writes what was read to a text file the reader chooses. */
  registerInvoke('ocr:writeText', async ({ sessionId, text }, event) => {
    const session = deps.documents.get(sessionId);
    if (session === undefined) {
      throw new AppError('internal/unexpected', { message: 'That document is no longer open.' });
    }

    const stem = path.basename(session.file.displayName, path.extname(session.file.displayName));
    const result = await dialog.showSaveDialog(deps.senderWindow(event), {
      title: 'Save the recognised text',
      buttonLabel: 'Save',
      defaultPath: path.join(path.dirname(session.file.path), `${stem}.txt`),
      filters: [{ name: 'Text files', extensions: ['txt'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    if (result.canceled || result.filePath === undefined) return CANCELED;

    // A byte order mark, because Notepad still reads UTF-8 better with one.
    await writeFileAtomic(result.filePath, `${BYTE_ORDER_MARK}${text}`);
    return { canceled: false, paths: [result.filePath], directory: path.dirname(result.filePath) };
  });
}

/** The size a PNG states in its header, without decoding the picture. */
function sizeOfPng(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (signature.some((value, index) => bytes[index] !== value)) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}
