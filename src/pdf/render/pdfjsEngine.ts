import {
  getDocument,
  GlobalWorkerOptions,
  PasswordResponses,
  TextLayer,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from 'pdfjs-dist';
import { AppError } from '@shared/errors/appError';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type {
  LoadDocumentOptions,
  LoadedPdfDocument,
  PdfLink,
  PdfLinkTarget,
  PdfPageGeometry,
  PdfRenderEngine,
  RenderPageOptions,
  RenderedPageSize,
  TextLayerOptions,
} from './types';

// The worker ships with the application; nothing is fetched from the network.
GlobalWorkerOptions.workerSrc = workerUrl;

/** Character maps and standard fonts are copied next to the renderer bundle. */
const CMAP_URL = 'pdfjs/cmaps/';
const STANDARD_FONT_URL = 'pdfjs/standard_fonts/';
const ICC_URL = 'pdfjs/iccs/';

/** Re-checked after every await: an abort can happen at any point. */
function isAborted(signal: AbortSignal | undefined): boolean {
  return signal !== undefined && signal.aborted;
}

interface PdfJsError {
  name?: string;
  message?: string;
  code?: number;
}

/** Turns a PDF.js failure into PaperForge's typed error vocabulary. */
export function toAppError(error: unknown): AppError {
  if (AppError.isAppError(error)) return error;
  const { name, message } = (error ?? {}) as PdfJsError;

  if (name === 'PasswordException') {
    return new AppError('pdf/wrong-password', { details: message });
  }
  if (name === 'InvalidPDFException') {
    return new AppError('pdf/invalid', { details: message });
  }
  if (name === 'MissingPDFException') {
    return new AppError('io/not-found', { details: message });
  }
  if (name === 'UnexpectedResponseException' || name === 'ResponseException') {
    return new AppError('pdf/malformed-content', {
      message: 'The document could not be read.',
      details: message,
    });
  }
  return new AppError('pdf/malformed-content', {
    message: 'The document could not be opened.',
    details: message ?? String(error),
  });
}

class PdfjsDocument implements LoadedPdfDocument {
  private readonly pageCache = new Map<number, Promise<PDFPageProxy>>();

  constructor(
    private readonly document: PDFDocumentProxy,
    private readonly task: PDFDocumentLoadingTask,
    readonly info: LoadedPdfDocument['info'],
    readonly pages: readonly PdfPageGeometry[],
  ) {}

  private getPage(pageNumber: number): Promise<PDFPageProxy> {
    const existing = this.pageCache.get(pageNumber);
    if (existing !== undefined) return existing;
    const promise = this.document.getPage(pageNumber);
    this.pageCache.set(pageNumber, promise);
    return promise;
  }

  pageSize(pageNumber: number, scale: number, rotation: number): RenderedPageSize {
    const geometry = this.pages[pageNumber - 1];
    if (geometry === undefined) return { width: 0, height: 0 };
    const quarterTurns = (((geometry.rotation + rotation) / 90) | 0) % 2;
    const width = quarterTurns === 0 ? geometry.width : geometry.height;
    const height = quarterTurns === 0 ? geometry.height : geometry.width;
    return { width: width * scale, height: height * scale };
  }

  async renderPage(options: RenderPageOptions): Promise<void> {
    const { pageNumber, scale, rotation, canvas, devicePixelRatio, signal } = options;
    const page = await this.getPage(pageNumber);
    if (isAborted(signal)) return;

    const viewport = page.getViewport({ scale: scale * devicePixelRatio, rotation });
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    canvas.style.width = `${Math.floor(viewport.width / devicePixelRatio)}px`;
    canvas.style.height = `${Math.floor(viewport.height / devicePixelRatio)}px`;

    const task = page.render({ canvas, viewport });
    const abort = (): void => task.cancel();
    signal?.addEventListener('abort', abort, { once: true });

    try {
      await task.promise;
    } catch (error) {
      // A cancelled render is the normal result of scrolling away.
      if ((error as PdfJsError).name === 'RenderingCancelledException') return;
      throw toAppError(error);
    } finally {
      signal?.removeEventListener('abort', abort);
    }
  }

  async renderTextLayer(options: TextLayerOptions): Promise<void> {
    const { pageNumber, scale, rotation, container, signal } = options;
    const page = await this.getPage(pageNumber);
    if (isAborted(signal)) return;

    const viewport = page.getViewport({ scale, rotation });
    container.replaceChildren();
    container.style.width = `${Math.floor(viewport.width)}px`;
    container.style.height = `${Math.floor(viewport.height)}px`;

    const layer = new TextLayer({
      textContentSource: page.streamTextContent(),
      container,
      viewport,
    });
    await layer.render();
    if (isAborted(signal)) container.replaceChildren();
  }

  async getLinks(pageNumber: number): Promise<PdfLink[]> {
    const page = await this.getPage(pageNumber);
    const annotations = await page.getAnnotations({ intent: 'display' });
    const links: PdfLink[] = [];

    for (const annotation of annotations) {
      const record = annotation as {
        id?: string;
        subtype?: string;
        rect?: number[];
        url?: string;
        dest?: unknown;
        contents?: string;
        title?: string;
      };
      if (record.subtype !== 'Link') continue;
      const rect = record.rect;
      if (rect === undefined || rect.length < 4) continue;

      links.push({
        id: record.id ?? `${pageNumber}-${links.length}`,
        rect: [rect[0] ?? 0, rect[1] ?? 0, rect[2] ?? 0, rect[3] ?? 0],
        target: await this.resolveTarget(record),
        title: record.contents ?? record.title ?? null,
      });
    }
    return links;
  }

  private async resolveTarget(record: { url?: string; dest?: unknown }): Promise<PdfLinkTarget> {
    if (typeof record.url === 'string' && record.url !== '') {
      return { kind: 'url', url: record.url };
    }
    if (record.dest === undefined || record.dest === null) return { kind: 'unsupported' };

    try {
      const destination: unknown[] | null =
        typeof record.dest === 'string'
          ? ((await this.document.getDestination(record.dest)) as unknown[] | null)
          : Array.isArray(record.dest)
            ? (record.dest as unknown[])
            : null;
      const reference = destination?.[0];
      if (reference === null || reference === undefined) return { kind: 'unsupported' };

      const index =
        typeof reference === 'number'
          ? reference
          : await this.document.getPageIndex(reference as never);
      return { kind: 'page', pageNumber: index + 1 };
    } catch {
      return { kind: 'unsupported' };
    }
  }

  async destroy(): Promise<void> {
    this.pageCache.clear();
    // The loading task owns the worker connection; destroying it tears down
    // the document too.
    await this.task.destroy();
  }
}

/** Reads every page's intrinsic size once, so the viewer can lay pages out. */
async function readGeometry(document: PDFDocumentProxy): Promise<PdfPageGeometry[]> {
  const labels = await document.getPageLabels().catch(() => null);
  const geometry: PdfPageGeometry[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const label = labels?.[pageNumber - 1] ?? null;
    geometry.push({
      pageNumber,
      width: viewport.width,
      height: viewport.height,
      rotation: page.rotate,
      label: label === String(pageNumber) ? null : label,
    });
    page.cleanup();
  }
  return geometry;
}

export class PdfjsRenderEngine implements PdfRenderEngine {
  async load(options: LoadDocumentOptions): Promise<LoadedPdfDocument> {
    const task = getDocument({
      url: options.url,
      cMapUrl: CMAP_URL,
      cMapPacked: true,
      standardFontDataUrl: STANDARD_FONT_URL,
      iccUrl: ICC_URL,
      // Documents are untrusted: no XFA scripting, and nothing fetched eagerly.
      enableXfa: false,
      disableAutoFetch: true,
    });

    let encrypted = false;
    task.onPassword = (updatePassword: (password: string) => void, reason: number) => {
      encrypted = true;
      const retry = reason === PasswordResponses.INCORRECT_PASSWORD;
      const ask = options.requestPassword;
      if (ask === undefined) {
        void task.destroy();
        return;
      }
      void ask(retry).then((password) => {
        if (password === null) {
          void task.destroy();
          return;
        }
        updatePassword(password);
      });
    };

    options.signal?.addEventListener('abort', () => void task.destroy(), { once: true });

    let document: PDFDocumentProxy;
    try {
      document = await task.promise;
    } catch (error) {
      if ((error as PdfJsError).name === 'PasswordException' && encrypted) {
        throw new AppError('pdf/encrypted', {
          message: 'This PDF is password protected.',
          details: (error as PdfJsError).message,
        });
      }
      throw toAppError(error);
    }

    const metadata = await document.getMetadata().catch(() => null);
    const title = (metadata?.info as { Title?: string } | undefined)?.Title ?? null;

    return new PdfjsDocument(
      document,
      task,
      {
        pageCount: document.numPages,
        fingerprint: document.fingerprints?.[0] ?? null,
        title: title === '' ? null : title,
        encrypted,
      },
      await readGeometry(document),
    );
  }
}
