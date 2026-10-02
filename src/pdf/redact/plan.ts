import { PDFName, type PDFDocument } from 'pdf-lib';
import type {
  RedactionMark,
  RedactionMarkPlan,
  RedactionPagePlan,
  RedactionPlan,
} from '@shared/schemas/redaction';
import { isTagged } from '../metadata/read';
import { annotationsUnder } from './annotations';
import { touchesAny } from './geometry';
import { analyzePage, type RemovedGlyph } from './page';
import { glyphCovered } from './text';

/**
 * What applying a set of marks would do, worked out before anything is done:
 * which pages can be cut and which must become pictures (and why), and what
 * each mark will take away. The reader reviews this before applying.
 */
export async function planRedactions(
  document: PDFDocument,
  marks: readonly RedactionMark[],
): Promise<Omit<RedactionPlan, 'revision'>> {
  const byPage = new Map<number, RedactionMark[]>();
  for (const mark of marks) {
    if (mark.page < 1 || mark.page > document.getPageCount()) continue;
    byPage.set(mark.page, [...(byPage.get(mark.page) ?? []), mark]);
  }

  const pages: RedactionPagePlan[] = [];
  const markPlans: RedactionMarkPlan[] = [];

  for (const [pageNumber, pageMarks] of [...byPage].sort(([first], [second]) => first - second)) {
    const page = document.getPage(pageNumber - 1);
    const analysis = await analyzePage(
      document,
      pageNumber - 1,
      pageMarks.flatMap((mark) => mark.rects),
    );
    pages.push({
      page: pageNumber,
      mode: analysis.raster.length > 0 ? 'raster' : 'native',
      reasons: analysis.raster,
    });

    for (const mark of pageMarks) {
      markPlans.push({
        id: mark.id,
        text: textOf(analysis.removed.filter((glyph) => glyphCovered(glyph.box, mark.rects))),
        images: analysis.affected.filter((bounds) => touchesAny(mark.rects, bounds)).length,
        annotations: annotationsUnder(document, page, mark.rects).length,
      });
    }
  }

  return { pages, marks: markPlans, notes: notesFor(document) };
}

/** What the removed glyphs said, with a space between separate runs. */
function textOf(glyphs: readonly RemovedGlyph[]): string {
  let text = '';
  let previous: number | null = null;
  for (const glyph of glyphs) {
    if (previous !== null && previous !== glyph.operationIndex && !/\s$/.test(text)) text += ' ';
    text += glyph.text;
    previous = glyph.operationIndex;
  }
  return text.replace(/\s+/g, ' ').trim().slice(0, 4000);
}

/** The places redaction by area does not reach, where this document has them. */
function notesFor(document: PDFDocument): string[] {
  const notes: string[] = [];
  if (isTagged(document)) {
    notes.push(
      'This document is tagged for accessibility. Descriptions kept in its tag structure, such as alternate text, are not changed by redaction.',
    );
  }
  if (document.catalog.get(PDFName.of('Outlines')) !== undefined) {
    notes.push('Bookmark titles are not changed by redaction. Check them in the Bookmarks panel.');
  }
  return notes;
}
