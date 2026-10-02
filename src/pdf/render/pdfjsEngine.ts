import {
  AnnotationMode,
  getDocument,
  GlobalWorkerOptions,
  PasswordResponses,
  TextLayer,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from 'pdfjs-dist';
import type { OptionalContentConfig } from 'pdfjs-dist/types/src/display/optional_content_config';
import { orderRows } from './layerOrder';
import { AppError } from '@shared/errors/appError';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type {
  LoadDocumentOptions,
  LoadedPdfDocument,
  PdfAttachment,
  PdfLayerEntry,
  PdfLink,
  PdfLinkTarget,
  PdfOutlineItem,
  PdfPageGeometry,
  PdfPageText,
  PdfRenderEngine,
  PdfTextItem,
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

interface RawOutlineItem {
  title?: string;
  bold?: boolean;
  italic?: boolean;
  color?: Uint8ClampedArray | number[] | null | undefined;
  dest?: unknown;
  url?: string | null;
  items?: RawOutlineItem[];
}

interface RawAttachment {
  filename?: string;
  content?: { length?: number };
  description?: string;
}

interface RawTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL?: boolean;
}

/** Outline colours arrive as three components in 0–255. */
function colorOf(color: Uint8ClampedArray | number[] | null | undefined): string | null {
  if (color === null || color === undefined || color.length < 3) return null;
  const [r = 0, g = 0, b = 0] = Array.from(color);
  if (r === 0 && g === 0 && b === 0) return null;
  return `rgb(${r}, ${g}, ${b})`;
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
  private readonly textCache = new Map<number, Promise<PdfPageText>>();

  constructor(
    private readonly document: PDFDocumentProxy,
    private readonly task: PDFDocumentLoadingTask,
    readonly info: LoadedPdfDocument['info'],
    readonly pages: readonly PdfPageGeometry[],
    /** Held so layer visibility survives between renders. */
    private readonly optionalContent: OptionalContentConfig | null,
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
    // `geometry` already carries the page's own rotation, so only the extra
    // view rotation can turn the page onto its side.
    const swapped = Math.abs(Math.round(rotation / 90)) % 2 === 1;
    const width = swapped ? geometry.height : geometry.width;
    const height = swapped ? geometry.width : geometry.height;
    return { width: width * scale, height: height * scale };
  }

  async renderPage(options: RenderPageOptions): Promise<void> {
    const { pageNumber, scale, rotation, canvas, devicePixelRatio, signal } = options;
    const page = await this.getPage(pageNumber);
    if (isAborted(signal)) return;

    // PDF.js treats `rotation` as the total rotation, not an extra one.
    const viewport = page.getViewport({
      scale: scale * devicePixelRatio,
      rotation: page.rotate + rotation,
    });
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    canvas.style.width = `${Math.floor(viewport.width / devicePixelRatio)}px`;
    canvas.style.height = `${Math.floor(viewport.height / devicePixelRatio)}px`;

    const layers = options.contentOnly === true ? null : await this.layersFor(options);
    if (isAborted(signal)) return;

    const task = page.render({
      canvas,
      viewport,
      // `ENABLE_FORMS` draws everything except the widgets a form layer draws
      // itself, which is exactly what filling a form in needs.
      ...(options.hideFormFields === true ? { annotationMode: AnnotationMode.ENABLE_FORMS } : {}),
      ...(options.contentOnly === true ? { annotationMode: AnnotationMode.DISABLE } : {}),
      ...(options.print === undefined
        ? {}
        : {
            intent: 'print',
            ...(options.print.annotations ? {} : { annotationMode: AnnotationMode.DISABLE }),
          }),
      ...(layers === null ? {} : { optionalContentConfigPromise: Promise.resolve(layers) }),
    });
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

    const viewport = page.getViewport({ scale, rotation: page.rotate + rotation });
    container.replaceChildren();
    container.style.width = `${Math.floor(viewport.width)}px`;
    container.style.height = `${Math.floor(viewport.height)}px`;
    // PDF.js sizes and stretches each span through these variables; without
    // them the spans keep the browser's default size and drift away from the
    // glyphs they stand for, so a selection would not cover what it shows.
    const userUnit = (viewport as { userUnit?: number }).userUnit ?? 1;
    container.style.setProperty('--total-scale-factor', String(viewport.scale * userUnit));
    container.style.setProperty('--scale-round-x', '1px');
    container.style.setProperty('--scale-round-y', '1px');

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

  async getOutline(): Promise<PdfOutlineItem[]> {
    const raw = await this.document.getOutline().catch(() => null);
    if (raw === null) return [];
    return this.convertOutline(raw, 'outline');
  }

  private async convertOutline(
    items: readonly RawOutlineItem[],
    prefix: string,
  ): Promise<PdfOutlineItem[]> {
    const converted: PdfOutlineItem[] = [];
    for (const [index, item] of items.entries()) {
      const id = `${prefix}-${index}`;
      const target = await this.resolveTarget({
        ...(typeof item.url === 'string' ? { url: item.url } : {}),
        dest: item.dest,
      });
      converted.push({
        id,
        title: item.title ?? '',
        bold: item.bold === true,
        italic: item.italic === true,
        color: colorOf(item.color ?? null),
        children: await this.convertOutline(item.items ?? [], id),
        pageNumber: target.kind === 'page' ? target.pageNumber : null,
      });
    }
    return converted;
  }

  async getAttachments(): Promise<PdfAttachment[]> {
    const raw = await this.document.getAttachments().catch(() => null);
    if (raw === null) return [];

    const entries = raw instanceof Map ? [...raw.entries()] : Object.entries(raw);

    return entries.map(([key, value]) => {
      const attachment = value as RawAttachment;
      return {
        id: key,
        fileName: attachment.filename ?? key,
        // The listing carries no bytes, so a size is only known when one of
        // the engines that does provide it has filled this in.
        sizeBytes: attachment.content?.length ?? null,
        description: attachment.description ?? null,
      };
    });
  }

  /**
   * The layer state a render uses. PDF.js keeps a separate one for printing,
   * so the reader's choices are copied onto it: a page prints as it is shown.
   */
  private async layersFor(options: RenderPageOptions): Promise<OptionalContentConfig | null> {
    if (this.optionalContent === null || options.print === undefined) return this.optionalContent;
    const config = await this.document.getOptionalContentConfig({ intent: 'print' });
    for (const [id, group] of this.optionalContent) {
      config.setVisibility(id, (group as { visible?: boolean }).visible !== false);
    }
    return config;
  }

  getLayers(): Promise<PdfLayerEntry[]> {
    const config = this.optionalContent;
    if (config === null) return Promise.resolve([]);

    const order = (config.getOrder() as unknown[] | null) ?? [];
    const entries: PdfLayerEntry[] = [];
    const seen = new Set<string>();
    for (const row of orderRows(order, 0)) {
      if ('heading' in row) {
        entries.push({ kind: 'heading', name: row.heading, depth: row.depth });
        continue;
      }
      const group = config.getGroup(row.id) as { name?: string | null; visible?: boolean } | null;
      if (group === null || seen.has(row.id)) continue;
      seen.add(row.id);
      entries.push({
        kind: 'layer',
        id: row.id,
        name: group.name ?? row.id,
        visible: group.visible !== false,
        depth: row.depth,
      });
    }
    return Promise.resolve(entries);
  }

  setLayerVisible(id: string, visible: boolean): void {
    this.optionalContent?.setVisibility(id, visible);
  }

  async getPageText(pageNumber: number): Promise<PdfPageText> {
    const cached = this.textCache.get(pageNumber);
    if (cached !== undefined) return cached;

    const promise = this.readPageText(pageNumber);
    this.textCache.set(pageNumber, promise);
    return promise;
  }

  private async readPageText(pageNumber: number): Promise<PdfPageText> {
    const page = await this.getPage(pageNumber);
    const content = await page.getTextContent();

    const items: PdfTextItem[] = [];
    const offsets: number[] = [];
    let text = '';

    for (const entry of content.items) {
      if (!('str' in entry)) continue;
      const item = entry as RawTextItem;
      offsets.push(text.length);
      items.push({
        str: item.str,
        // transform is [a, b, c, d, e, f]; e and f are the baseline origin.
        x: item.transform[4] ?? 0,
        y: item.transform[5] ?? 0,
        width: item.width,
        height: item.height,
      });
      text += item.str;
      if (item.hasEOL === true) text += '\n';
    }

    return { pageNumber, text, items, offsets };
  }

  async destroy(): Promise<void> {
    this.pageCache.clear();
    this.textCache.clear();
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
    const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = page.view;
    geometry.push({
      pageNumber,
      width: viewport.width,
      height: viewport.height,
      rotation: page.rotate,
      label: label === String(pageNumber) ? null : label,
      viewBox: [x1, y1, x2, y2],
      userUnit: page.userUnit,
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

    const optionalContent = await document.getOptionalContentConfig().catch(() => null);

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
      optionalContent,
    );
  }
}
