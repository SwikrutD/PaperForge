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
  /**
   * The page's box in PDF user space, [x1, y1, x2, y2], before rotation. It is
   * the space annotation and text coordinates are given in, and its origin is
   * not always zero.
   */
  viewBox: readonly [number, number, number, number];
  /** Default user space units per PDF unit; 1 for nearly every document. */
  userUnit: number;
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
  /**
   * Leaves the form fields out of the picture, for when they are being drawn
   * as real controls on top of it. Without this the page would show what a
   * field holds and the control would show it again, half a line apart.
   */
  hideFormFields?: boolean;
  /**
   * Draws only the page's own content: no annotations, and layers as the
   * document sets them rather than as the reader has switched them. This is
   * the picture redaction puts in place of a page.
   */
  contentOnly?: boolean;
  /**
   * Draws the page for a printer: annotations the document marks as not for
   * printing are left out, and `annotations: false` leaves out every one.
   * Layers stay as the reader has switched them.
   */
  print?: { annotations: boolean };
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

/** One entry of the document outline, as authored. */
export interface PdfOutlineItem {
  id: string;
  title: string;
  bold: boolean;
  italic: boolean;
  /** Colour the author gave the entry, as a CSS value. */
  color: string | null;
  children: PdfOutlineItem[];
  /** Page the entry points at, resolved when the outline is read. */
  pageNumber: number | null;
}

/** A file embedded in the document. PaperForge never opens one on its own. */
export interface PdfAttachment {
  id: string;
  fileName: string;
  /**
   * Size in bytes, or null when reading the listing does not reveal one —
   * which is the usual case, since the bytes are only fetched on demand.
   */
  sizeBytes: number | null;
  description: string | null;
}

/** An optional content group — what other tools call a layer. */
export interface PdfLayer {
  kind: 'layer';
  id: string;
  name: string;
  visible: boolean;
  /** How far the document nests it under other layers or headings. */
  depth: number;
}

/** A label the document groups layers under, which is not a layer itself. */
export interface PdfLayerHeading {
  kind: 'heading';
  name: string;
  depth: number;
}

/** The layers panel, in the order and nesting the document gives. */
export type PdfLayerEntry = PdfLayer | PdfLayerHeading;

/** One run of text as the document lays it out, in PDF user space. */
export interface PdfTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfPageText {
  pageNumber: number;
  /** Every item joined, which is what a search runs over. */
  text: string;
  items: PdfTextItem[];
  /** Offset of each item within `text`, same order as `items`. */
  offsets: number[];
}

export interface LoadedPdfDocument {
  readonly info: PdfDocumentInfo;
  readonly pages: readonly PdfPageGeometry[];
  /** Page size in CSS pixels for a given scale and extra rotation. */
  pageSize(pageNumber: number, scale: number, rotation: number): RenderedPageSize;
  renderPage(options: RenderPageOptions): Promise<void>;
  renderTextLayer(options: TextLayerOptions): Promise<void>;
  getLinks(pageNumber: number): Promise<PdfLink[]>;
  /** The document outline, empty when the document has none. */
  getOutline(): Promise<PdfOutlineItem[]>;
  getAttachments(): Promise<PdfAttachment[]>;
  /** Optional content groups; empty when the document defines none. */
  getLayers(): Promise<PdfLayerEntry[]>;
  setLayerVisible(id: string, visible: boolean): void;
  /** Text of one page, used by search and by the no-text-layer check. */
  getPageText(pageNumber: number): Promise<PdfPageText>;
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
