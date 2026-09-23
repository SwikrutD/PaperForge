import { PDFDocument, degrees, type PDFImage, type PDFPage } from 'pdf-lib';
import { AppError } from '@shared/errors/appError';
import type { Annotation, AnnotationInput, AnnotationPatch } from '@shared/schemas/annotation';
import type { EditOperation } from '@shared/schemas/edit';
import { readAnnotations, type AnnotationRecord } from './annotations/read';
import {
  embedAppearanceFont,
  removeAnnotations,
  rewriteAnnotation,
  setResolved,
  writeAnnotation,
  type WriteContext,
} from './annotations/write';
import { normalizePages, rotationAfter } from './operations';
import { applyPageOperation, type PageContext } from './pages';
import { applyTextOperation } from './text';
import { applyImageOperation } from './images';
import { applyLinkOperation } from './links';
import { applyFurnitureOperation } from './furniture';
import type { DocumentFacts, MutationResult, PdfMutationEngine, StagedAsset } from './types';

/**
 * The write engine, and the only file that imports pdf-lib.
 *
 * pdf-lib rewrites the whole file rather than appending an incremental update,
 * so every mutation produces a complete document. That is what makes a
 * revision a genuine snapshot, and it is why PaperForge does not claim
 * byte-level incremental saving (CLAUDE.md section 9).
 */
export class PdfLibMutationEngine implements PdfMutationEngine {
  async inspect(bytes: Uint8Array): Promise<DocumentFacts> {
    try {
      const document = await load(bytes);
      // Reading the page tree is where a file that only looks like a PDF
      // finally gives itself away, so it counts as part of the inspection.
      return { pageCount: document.getPageCount(), encrypted: false };
    } catch (error) {
      const failure = toMutationError(error);
      if (failure.code === 'pdf/unsupported-encryption') {
        return { pageCount: 0, encrypted: true };
      }
      throw failure;
    }
  }

  async readAnnotations(bytes: Uint8Array): Promise<Annotation[]> {
    const document = await load(bytes);
    try {
      return readAnnotations(document).map((record) => record.annotation);
    } catch (error) {
      throw toMutationError(error);
    }
  }

  async apply(
    bytes: Uint8Array,
    operations: readonly EditOperation[],
    assets: ReadonlyMap<string, StagedAsset> = new Map(),
  ): Promise<MutationResult> {
    const document = await load(bytes);

    try {
      // pdf-lib's page cache is not invalidated when a page is removed, so
      // pages are held by identity and the running order is kept here rather
      // than asked for again.
      const pageContext: PageContext = {
        document,
        order: document.getPages().slice(),
        assets,
        sources: new Map(),
      };
      let annotations: AnnotationContext | null = null;
      // Reading the annotations that are already there is only worth doing
      // once, and only for the operations that need it.
      const annotationContext = async (): Promise<AnnotationContext> => {
        annotations ??= await createContext(document, assets);
        return annotations;
      };

      for (const operation of operations) {
        // Anything that changes which pages exist invalidates what was read
        // about the annotations on them.
        if (await applyPageOperation(pageContext, operation)) {
          annotations = null;
          continue;
        }

        // Rewriting text or moving an image replaces a page's content stream,
        // which says nothing about its annotations.
        if (await applyTextOperation(document, operation)) continue;
        if (await applyImageOperation(document, operation, assets)) continue;
        if (applyLinkOperation(document, operation)) continue;
        if (
          'pages' in operation &&
          operation.pages !== null &&
          (await applyFurnitureOperation(
            document,
            operation,
            assets,
            normalizePages(operation.pages, pageContext.order.length),
          ))
        ) {
          continue;
        }

        switch (operation.kind) {
          case 'rotatePages': {
            for (const page of pagesFor(pageContext.order, operation.pages)) {
              page.setRotation(degrees(rotationAfter(page.getRotation().angle, operation.degrees)));
            }
            break;
          }

          case 'deletePages': {
            const doomed = new Set(pagesFor(pageContext.order, operation.pages));
            // Highest index first, so each removal leaves the lower ones alone.
            for (let index = pageContext.order.length - 1; index >= 0; index -= 1) {
              if (doomed.has(pageContext.order[index] as PDFPage)) document.removePage(index);
            }
            pageContext.order = pageContext.order.filter((page) => !doomed.has(page));
            annotations = null;
            break;
          }

          case 'addAnnotations': {
            const context = await annotationContext();
            for (const input of operation.annotations) {
              const page = pageContext.order[input.pageNumber - 1];
              if (page === undefined) continue;
              const now = new Date();
              writeAnnotation(context.write, page, input, nextAnnotationId(), {
                createdAt: now,
                modifiedAt: now,
              });
            }
            break;
          }

          case 'updateAnnotations': {
            applyUpdates(await annotationContext(), operation.updates);
            // The records now describe the file as it was before the update.
            annotations = null;
            break;
          }

          case 'deleteAnnotations': {
            const context = await annotationContext();
            const byId = new Map(context.records.map((record) => [record.annotation.id, record]));
            const byPage = new Map<number, Set<string>>();

            for (const id of operation.ids) {
              const record = byId.get(id);
              if (record === undefined) continue;
              const refs = byPage.get(record.pageIndex) ?? new Set<string>();
              refs.add(record.ref);
              byPage.set(record.pageIndex, refs);
            }

            for (const [pageIndex, refs] of byPage) {
              const page = pageContext.order[pageIndex];
              if (page !== undefined) removeAnnotations(page, refs);
            }
            annotations = null;
            break;
          }
        }
      }

      return { bytes: await save(document), pageCount: document.getPageCount() };
    } catch (error) {
      throw toMutationError(error);
    }
  }
}

interface AnnotationContext {
  write: WriteContext;
  records: AnnotationRecord[];
}

/** Embeds what appearances need, once, and reads what is already there. */
async function createContext(
  document: PDFDocument,
  assets: ReadonlyMap<string, StagedAsset>,
): Promise<AnnotationContext> {
  const embedded = new Map<string, PDFImage>();
  for (const [token, asset] of assets) {
    if (asset.kind !== 'image') continue;
    embedded.set(
      token,
      asset.format === 'png'
        ? await document.embedPng(asset.bytes)
        : await document.embedJpg(asset.bytes),
    );
  }

  return {
    write: { document, font: embedAppearanceFont(document), images: embedded },
    records: readAnnotations(document),
  };
}

/** Applies patches to annotations that are already in the document. */
function applyUpdates(
  context: AnnotationContext,
  updates: readonly { id: string; patch: AnnotationPatch }[],
): void {
  const byId = new Map(context.records.map((record) => [record.annotation.id, record]));

  for (const update of updates) {
    const record = byId.get(update.id);
    if (record === undefined) continue;

    const { patch } = update;
    const current = record.annotation;
    const resolved = patch.resolved ?? current.resolved;

    // A resolved flag on its own does not need the annotation redrawn.
    const onlyStatus =
      patch.style === undefined &&
      patch.geometry === undefined &&
      patch.contents === undefined &&
      patch.author === undefined &&
      patch.subject === undefined;

    if (onlyStatus) {
      setResolved(record.dict, resolved);
      continue;
    }

    if (!current.editable) {
      // PaperForge could not read this annotation's geometry, so it cannot
      // redraw it. Only its status and text are touched.
      setResolved(record.dict, resolved);
      continue;
    }

    const input: AnnotationInput = {
      pageNumber: current.pageNumber,
      geometry: patch.geometry ?? current.geometry,
      style: mergeStyle(current.style, patch.style),
      contents: patch.contents ?? current.contents,
      author: patch.author ?? current.author,
      subject: patch.subject ?? current.subject,
      ...(current.stampLabel === undefined ? {} : { stampLabel: current.stampLabel }),
    };

    rewriteAnnotation(context.write, record.dict, input, { ...current, resolved }, new Date());
  }
}

/**
 * Applies the fields a patch actually sets. An explicit undefined means "leave
 * this alone", which spreading would read as "clear it".
 */
function mergeStyle(
  current: Annotation['style'],
  patch: AnnotationPatch['style'],
): Annotation['style'] {
  if (patch === undefined) return current;
  const merged = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) Object.assign(merged, { [key]: value });
  }
  return merged;
}

function pagesFor(order: readonly PDFPage[], pages: readonly number[]): PDFPage[] {
  return normalizePages(pages, order.length).map((pageNumber) => order[pageNumber - 1] as PDFPage);
}

/** Identity for a new annotation, written to its `/NM`. */
function nextAnnotationId(): string {
  return `pf-${globalThis.crypto.randomUUID()}`;
}

async function load(bytes: Uint8Array): Promise<PDFDocument> {
  try {
    // The document's own metadata is left alone: PaperForge does not quietly
    // stamp itself as the producer of somebody else's file.
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (error) {
    throw toMutationError(error);
  }
}

async function save(document: PDFDocument): Promise<Uint8Array> {
  try {
    return await document.save({ useObjectStreams: true });
  } catch (error) {
    throw new AppError('io/write-failed', {
      message: 'The changed document could not be written.',
      details: messageOf(error),
      cause: error,
    });
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Turns a pdf-lib failure into PaperForge's typed error vocabulary. */
export function toMutationError(error: unknown): AppError {
  if (AppError.isAppError(error)) return error;
  const message = messageOf(error);
  const name = error instanceof Error ? error.name : '';

  if (name === 'EncryptedPDFError' || message.includes('is encrypted')) {
    return new AppError('pdf/unsupported-encryption', {
      message: 'PaperForge cannot change an encrypted document yet.',
      details: message,
      cause: error,
    });
  }
  return new AppError('pdf/malformed-content', {
    message: 'This document could not be changed because part of it is damaged.',
    details: message,
    cause: error,
  });
}
