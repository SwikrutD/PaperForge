/**
 * The rendering contract the viewer is written against.
 *
 * Nothing above this file imports PDF.js, so a second engine can be added
 * later without touching the UI (CLAUDE.md section 2.3).
 */

/** Intrinsic page size at scale 1, with the page's own rotation applied. */
export interface PdfPageGeometry {
  pageNumber: number;
  width: number;
  height: number;
  /** Rotation baked into the page, in degrees. */
  rotation: number;
  /** Page label from the document, when it differs from the number. */
  label: string | null;
}

export interface PdfDocumentInfo {
  pageCount: number;
  /** PDF.js fingerprint, useful for caching and diagnostics. */
  fingerprint: string | null;
  title: string | null;
  /** True when the file was encrypted and a password unlocked it. */
  encrypted: boolean;
}

export interface RenderPageOptions {
  pageNumber: number;
  /** CSS pixels per PDF unit, before the device pixel ratio. */
  scale: number;
  /** Extra rotation applied on top of the page's own, in degrees. */
  rotation: number;
  canvas: HTMLCanvasElement;
  /** Device pixel ratio to render at, so text stays sharp on high-DPI screens. */
  devicePixelRatio: number;
  signal?: AbortSignal;
}

export interface RenderedPageSize {
  /** Size in CSS pixels. */
  width: number;
  height: number;
}

export interface TextLayerOptions {
  pageNumber: number;
  scale: number;
  rotation: number;
  container: HTMLElement;
  signal?: AbortSignal;
}

export type PdfLinkTarget =
  { kind: 'page'; pageNumber: number } | { kind: 'url'; url: string } | { kind: 'unsupported' };

export interface PdfLink {
  id: string;
  /** Rectangle in PDF user space: [x1, y1, x2, y2]. */
  rect: [number, number, number, number];
  target: PdfLinkTarget;
  /** Tooltip text from the annotation, if any. */
  title: string | null;
}

export interface LoadedPdfDocument {
  readonly info: PdfDocumentInfo;
  readonly pages: readonly PdfPageGeometry[];
  /** Page size in CSS pixels for a given scale and extra rotation. */
  pageSize(pageNumber: number, scale: number, rotation: number): RenderedPageSize;
  renderPage(options: RenderPageOptions): Promise<void>;
  renderTextLayer(options: TextLayerOptions): Promise<void>;
  getLinks(pageNumber: number): Promise<PdfLink[]>;
  destroy(): Promise<void>;
}

export interface LoadDocumentOptions {
  url: string;
  /**
   * Asked for a password when the document is encrypted. Returning null
   * cancels the load. Called again with `retry` when a password was wrong.
   */
  requestPassword?: (retry: boolean) => Promise<string | null>;
  signal?: AbortSignal;
}

export interface PdfRenderEngine {
  load(options: LoadDocumentOptions): Promise<LoadedPdfDocument>;
}
