import type { Annotation } from '@shared/schemas/annotation';
import type { EditOperation } from '@shared/schemas/edit';

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

/** An image staged for stamping, with the format its bytes are in. */
export interface StampImageBytes {
  bytes: Uint8Array;
  format: 'png' | 'jpeg';
}

export interface PdfMutationEngine {
  inspect(bytes: Uint8Array): Promise<DocumentFacts>;
  /** Every annotation in the document, as the file itself records them. */
  readAnnotations(bytes: Uint8Array): Promise<Annotation[]>;
  /**
   * Applies operations in order and returns the new document. The input bytes
   * are never modified: a caller keeps its own copy either way.
   *
   * `images` holds the bytes an image stamp needs, by the token its annotation
   * refers to, so image data never travels over IPC.
   */
  apply(
    bytes: Uint8Array,
    operations: readonly EditOperation[],
    images?: ReadonlyMap<string, StampImageBytes>,
  ): Promise<MutationResult>;
}
