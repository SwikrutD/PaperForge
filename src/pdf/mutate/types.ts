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

/**
 * A file the main process has staged for a change to use: an image to stamp or
 * to put on a page of its own, or another PDF to take pages from. The bytes
 * stay in the main process; an operation refers to one by token.
 */
export type StagedAsset =
  | { kind: 'image'; bytes: Uint8Array; format: 'png' | 'jpeg'; width: number; height: number }
  | { kind: 'pdf'; bytes: Uint8Array; pageCount: number };

export interface PdfMutationEngine {
  inspect(bytes: Uint8Array): Promise<DocumentFacts>;
  /** Every annotation in the document, as the file itself records them. */
  readAnnotations(bytes: Uint8Array): Promise<Annotation[]>;
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
