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

export interface PdfMutationEngine {
  inspect(bytes: Uint8Array): Promise<DocumentFacts>;
  /**
   * Applies operations in order and returns the new document. The input bytes
   * are never modified: a caller keeps its own copy either way.
   */
  apply(bytes: Uint8Array, operations: readonly EditOperation[]): Promise<MutationResult>;
}
