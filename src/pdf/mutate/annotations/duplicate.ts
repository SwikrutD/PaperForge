import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFStream,
  PDFString,
  type PDFDocument,
  type PDFPage,
} from 'pdf-lib';
import { AppError } from '@shared/errors/appError';
import type { AnnotationRecord } from './read';
import { BOX_KINDS, UPRIGHT_KEY } from './stampTransform';

/**
 * Copying an annotation onto its page, a little way off.
 *
 * The copy is the annotation's own dictionary, not a redrawing of it: a
 * signature from an earlier session has no picture PaperForge could draw
 * again, but its appearance can be copied. Each appearance stream is copied
 * too, so turning or resizing one of the two leaves the other as it is.
 *
 * Only a box is copied — a stamp, a shape, a text box — because moving one is
 * moving its rectangle. A mark whose points are written out (ink, lines, text
 * markup) would need every one of them moving, and is refused.
 */

/** Entries that tie an annotation to others, which a copy must not share. */
const LINKS = ['Popup', 'IRT', 'Parent', 'StructParent'];

export function duplicateAnnotation(
  document: PDFDocument,
  record: AnnotationRecord,
  page: PDFPage,
  newId: string,
  offset: { dx: number; dy: number },
): void {
  if (!record.annotation.editable || !BOX_KINDS.has(record.annotation.geometry.kind)) {
    throw new AppError('internal/unexpected', {
      message: 'That mark cannot be duplicated yet; only stamps, shapes and text boxes can.',
      details: `${record.annotation.geometry.kind} ${record.annotation.id}`,
    });
  }

  const { context } = document;
  const copy = record.dict.clone(context);
  for (const key of LINKS) copy.delete(PDFName.of(key));
  copy.set(PDFName.of('NM'), PDFString.of(newId));
  copy.set(PDFName.of('P'), page.ref);

  for (const key of ['Rect', UPRIGHT_KEY]) {
    const moved = shifted(copy.lookup(PDFName.of(key)), offset);
    if (moved !== null) copy.set(PDFName.of(key), context.obj(moved));
  }

  const appearances = copy.lookup(PDFName.of('AP'));
  if (appearances instanceof PDFDict) {
    copy.set(PDFName.of('AP'), copyAppearances(document, appearances));
  }

  page.node.addAnnot(context.register(copy));
}

/** A rectangle moved by an offset, or null when the entry is not one. */
function shifted(value: unknown, offset: { dx: number; dy: number }): number[] | null {
  if (!(value instanceof PDFArray) || value.size() < 4) return null;
  return [0, 1, 2, 3].map((index) => {
    const entry = value.lookup(index);
    const number = entry instanceof PDFNumber ? entry.asNumber() : 0;
    return number + (index % 2 === 0 ? offset.dx : offset.dy);
  });
}

/**
 * The appearance dictionary with every stream in it copied: `/N`, `/R` and
 * `/D`, each either a stream or a dictionary of streams by state.
 */
function copyAppearances(document: PDFDocument, appearances: PDFDict): PDFDict {
  const { context } = document;
  const copied = appearances.clone(context);
  for (const [key, value] of appearances.entries()) {
    const target = context.lookup(value);
    if (target instanceof PDFStream) {
      copied.set(key, context.register(target.clone(context)));
    } else if (target instanceof PDFDict) {
      const states = target.clone(context);
      for (const [state, stream] of target.entries()) {
        const looked = stream instanceof PDFRef ? context.lookup(stream) : stream;
        if (looked instanceof PDFStream) states.set(state, context.register(looked.clone(context)));
      }
      copied.set(key, states);
    }
  }
  return copied;
}
