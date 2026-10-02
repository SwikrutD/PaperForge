import type { Annotation } from '@shared/schemas/annotation';
import type { EmbeddedFile } from '@shared/schemas/attachment';
import type { EditOperation } from '@shared/schemas/edit';
import type { DocumentContentProperties } from '@shared/schemas/metadata';
import type { SanitizeReport } from '@shared/schemas/sanitize';
import type { SecuritySummary } from '@shared/schemas/protect';
import type { AccessibilityReport, ReadingOrder } from '@shared/schemas/accessibility';
import type { BookmarkNode } from '@shared/schemas/bookmark';
import type { OptimizeAnalysis, OptimizeReport, OptimizeSettings } from '@shared/schemas/optimize';
import type { ImageCodec } from '../optimize/pixels';
import type {
  RedactionMark,
  RedactionPlan,
  RedactionSearch,
  RedactionSearchResult,
} from '@shared/schemas/redaction';

/**
 * The mutation contract the editing features are written against.
 *
 * Nothing above this file imports pdf-lib, so the write engine can be replaced
 * — or joined by a second one for the cases it cannot handle — without
 * touching the callers (CLAUDE.md section 2.3).
 */

/** What can be learned about a document without changing it. */
export interface DocumentFacts {
  pageCount: number;
  /** True when the document is encrypted, which PaperForge cannot yet edit. */
  encrypted: boolean;
}

export interface MutationResult {
  bytes: Uint8Array;
  pageCount: number;
}

/**
 * A file the main process has staged for a change to use: an image to stamp or
 * to put on a page of its own, another PDF to take pages from, or any file at
 * all to carry inside the document. The bytes stay in the main process; an
 * operation refers to one by token.
 */
export type StagedAsset =
  | { kind: 'image'; bytes: Uint8Array; format: 'png' | 'jpeg'; width: number; height: number }
  | { kind: 'pdf'; bytes: Uint8Array; pageCount: number }
  | {
      kind: 'file';
      bytes: Uint8Array;
      fileName: string;
      /** The media type, when the extension names one PaperForge recognises. */
      mimeType: string | null;
      modifiedAt: Date;
    };

/** One attachment's name and bytes, for writing it out to disk. */
export interface ExtractedAttachment {
  fileName: string;
  bytes: Uint8Array;
  risky: boolean;
}

export interface PdfMutationEngine {
  inspect(bytes: Uint8Array): Promise<DocumentFacts>;
  /** Every annotation in the document, as the file itself records them. */
  readAnnotations(bytes: Uint8Array): Promise<Annotation[]>;
  /**
   * Metadata, fonts and page sizes. Security is not here: an encrypted
   * document is exactly the one this engine cannot open, and describing its
   * security is a job for the file's own bytes.
   */
  readProperties(bytes: Uint8Array): Promise<DocumentContentProperties>;
  /** Files carried inside the document. Reading one does not open it. */
  readAttachments(bytes: Uint8Array): Promise<EmbeddedFile[]>;
  /**
   * The bytes of one attachment, or null when it is no longer there. Nothing
   * is executed: the caller writes them where the reader asked.
   */
  extractAttachment(bytes: Uint8Array, id: string): Promise<ExtractedAttachment | null>;
  /** What the document carries besides the pages it shows. */
  scanHiddenInformation(bytes: Uint8Array): Promise<SanitizeReport>;
  /**
   * The Accessibility Check. `security` is what the file's bytes say, which
   * decides whether assistive technology may read the text at all.
   */
  checkAccessibility(
    bytes: Uint8Array,
    security: SecuritySummary,
  ): Promise<Omit<AccessibilityReport, 'revision'>>;
  /** The document outline, addressed the way the bookmark operations address it. */
  readBookmarks(bytes: Uint8Array): Promise<BookmarkNode[]>;
  /** One page's content in the order its tags read it. */
  readReadingOrder(bytes: Uint8Array, page: number): Promise<Omit<ReadingOrder, 'revision'>>;
  /**
   * What applying marks would remove, and which pages cannot be cut without
   * being drawn as pictures. Nothing is changed.
   */
  planRedactions(
    bytes: Uint8Array,
    marks: readonly RedactionMark[],
  ): Promise<Omit<RedactionPlan, 'revision'>>;
  /** Where text occurs, as the boxes of the glyphs redaction would remove. */
  findForRedaction(
    bytes: Uint8Array,
    search: RedactionSearch,
  ): Promise<Omit<RedactionSearchResult, 'revision'>>;
  /**
   * Reads the document object by object — without trusting its
   * cross-reference table — and writes it out whole, keeping only what the
   * document still reaches. This is how a damaged file is repaired when qpdf
   * is not installed; the input bytes are not modified.
   */
  rewrite(bytes: Uint8Array): Promise<MutationResult>;
  /** What an optimisation could act on: pictures, streams, thumbnails, metadata. */
  analyzeForOptimize(bytes: Uint8Array): Promise<Omit<OptimizeAnalysis, 'qpdfAvailable'>>;
  /**
   * Writes a smaller document. JPEG pictures need `codec`; without one they
   * are left as they are and only lossless work is done.
   */
  optimize(
    bytes: Uint8Array,
    settings: OptimizeSettings,
    codec: ImageCodec | null,
  ): Promise<{ bytes: Uint8Array; report: OptimizeReport }>;
  /**
   * Applies operations in order and returns the new document. The input bytes
   * are never modified: a caller keeps its own copy either way.
   *
   * `assets` holds the files an operation refers to by token — an image to
   * stamp, an image to make a page of, another document to take pages from —
   * so their bytes never travel over IPC.
   */
  apply(
    bytes: Uint8Array,
    operations: readonly EditOperation[],
    assets?: ReadonlyMap<string, StagedAsset>,
  ): Promise<MutationResult>;
}
