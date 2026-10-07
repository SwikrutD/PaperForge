import { PDFName, type PDFDocument } from 'pdf-lib';
import { AppError } from '@shared/errors/appError';
import type { EditOperation } from '@shared/schemas/edit';
import type { TextStyle } from '@shared/schemas/text';
import { readPageContent, type PageContent } from '@pdf/content/pageContent';
import { rewriteRunText } from '@pdf/content/editText';
import { appendTextBlock, neutralizeRun } from '@pdf/content/drawText';
import { matrixScale, multiply, type Matrix } from '@pdf/content/state';
import { seenFontSize, type TextRun } from '@pdf/content/textRuns';
import { encodeWinAnsi } from '@pdf/text/layout';
import { ensureFontResource } from './textResources';

/**
 * Changing the text a page draws.
 *
 * Three things can happen to a run: it is rewritten in the font that drew it
 * (Tier A), it is taken out and drawn again in a font PaperForge controls
 * (Tier B), or text is added where there was none. All three end as content
 * for the page, written back as one stream.
 *
 * The run to change is named by the operation it came from, which is stable
 * for as long as the content is: every change produces a new revision, the
 * page is read again, and the ids are handed out again with it.
 */

/** How a run is named outside this process. */
export function runIdOf(run: TextRun): string {
  return `op${String(run.operationIndex)}`;
}

export function findRun(content: PageContent, runId: string): TextRun | undefined {
  return content.runs.find((run) => runIdOf(run) === runId);
}

/** Replaces a page's content with the bytes given, as a single stream. */
export function setPageContent(document: PDFDocument, pageIndex: number, bytes: Uint8Array): void {
  const page = document.getPage(pageIndex);
  // A single uncompressed stream: what PaperForge writes it can read back,
  // and the optimizer compresses a document when the reader asks it to.
  const stream = document.context.stream(bytes);
  const ref = document.context.register(stream);
  page.node.set(PDFName.of('Contents'), ref);
}

/** Applies a text operation; returns false when it is not one. */
export async function applyTextOperation(
  document: PDFDocument,
  operation: EditOperation,
): Promise<boolean> {
  if (
    operation.kind !== 'editText' &&
    operation.kind !== 'replaceText' &&
    operation.kind !== 'addText'
  ) {
    return false;
  }

  const pageIndex = operation.page - 1;
  if (pageIndex < 0 || pageIndex >= document.getPageCount()) {
    throw new AppError('internal/unexpected', {
      message: 'That page is not in this document any more.',
      details: `page ${String(operation.page)} of ${String(document.getPageCount())}`,
    });
  }

  if (operation.kind === 'addText') {
    const content = await readPageContent(document, pageIndex);
    const style = operation.style;
    const resource = await ensureFontResource(document, document.getPage(pageIndex), style);
    const matrix: Matrix = { a: 1, b: 0, c: 0, d: 1, e: operation.x, f: operation.y };

    setPageContent(
      document,
      pageIndex,
      appendTextBlock(content.bytes, matrix, drawable(operation.text), {
        fontResource: resource,
        size: style.size,
        color: style.color,
      }),
    );
    return true;
  }

  const content = await readPageContent(document, pageIndex);
  const run = findRun(content, operation.runId);
  if (run === undefined) {
    throw new AppError('pdf/malformed-content', {
      message: 'That text is no longer where it was; close the editor and try again.',
      details: `run ${operation.runId} on page ${String(operation.page)}`,
    });
  }

  if (operation.kind === 'editText') {
    const result = rewriteRunText(content.bytes, run, operation.text);
    if (!result.ok) {
      throw new AppError('pdf/malformed-content', {
        message:
          result.reason === 'no-font'
            ? 'PaperForge cannot tell which font drew that text, so it cannot rewrite it.'
            : `The font this text is drawn in cannot write “${result.character ?? '?'}”.`,
        details: `run ${operation.runId} on page ${String(operation.page)}`,
      });
    }
    setPageContent(document, pageIndex, result.bytes);
    return true;
  }

  // Tier B: the original glyphs come out, and the new text is drawn over the
  // page in a font PaperForge controls.
  const style = operation.style ?? styleOf(run);
  const resource = await ensureFontResource(document, document.getPage(pageIndex), style);
  const emptied = neutralizeRun(content.bytes, run);

  setPageContent(
    document,
    pageIndex,
    appendTextBlock(emptied, replacementMatrix(run), drawable(operation.text), {
      fontResource: resource,
      size: style.size,
      color: style.color,
      ...(run.charSpacing === 0 ? {} : { charSpacing: run.charSpacing }),
      ...(run.wordSpacing === 0 ? {} : { wordSpacing: run.wordSpacing }),
      ...(run.horizontalScale === 100 ? {} : { horizontalScale: run.horizontalScale }),
      // The words of a recognised scan sit invisibly over its picture; a
      // corrected word must stay invisible, or it is printed over the scan.
      renderMode: run.invisible ? 3 : 0,
    }),
  );
  return true;
}

/**
 * Where replacement text goes: exactly where the original sat.
 *
 * The run's matrix already carries the page's own transform, so the text
 * lands in the same place at the same angle. Its scale is divided back out,
 * so `Tf` alone sets the size: a page that draws at `1 Tf` and scales the
 * matrix still gets text of the size the reader chose (or saw, by default).
 */
function replacementMatrix(run: TextRun): Matrix {
  const rise: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: run.rise };
  const scale = matrixScale(run.matrix).y;
  const unscale = scale === 0 ? 1 : 1 / scale;
  const normalize: Matrix = { a: unscale, b: 0, c: 0, d: unscale, e: 0, f: 0 };
  return multiply(normalize, multiply(rise, run.matrix));
}

/** The style a replacement takes when the reader did not choose one. */
function styleOf(run: TextRun): TextStyle {
  const base = (run.font?.baseFont ?? '').toLowerCase();
  const family =
    base.includes('times') || base.includes('serif')
      ? 'times'
      : base.includes('courier') || base.includes('mono')
        ? 'courier'
        : 'helvetica';

  return {
    family,
    bold: /bold|black|heavy/.test(base),
    italic: /italic|oblique/.test(base),
    // The size the run is seen at, which is what Tf sets once the
    // replacement matrix has divided its own scale out.
    size: run.fontSize === 0 ? 12 : seenFontSize(run),
    color: colorOf(run),
  };
}

function colorOf(run: TextRun): { r: number; g: number; b: number } {
  const [first = 0, second = 0, third = 0, fourth = 0] = run.color.components;
  if (run.color.space === 'rgb') return { r: first, g: second, b: third };
  if (run.color.space === 'gray') return { r: first, g: first, b: first };
  if (run.color.space === 'cmyk') {
    return {
      r: (1 - first) * (1 - fourth),
      g: (1 - second) * (1 - fourth),
      b: (1 - third) * (1 - fourth),
    };
  }
  return { r: 0, g: 0, b: 0 };
}

/**
 * What a standard font can draw.
 *
 * The standard fonts are written in WinAnsi: Latin-1 plus the punctuation in
 * 0x80–0x9F (curly quotes, dashes, ellipsis, euro, bullets), all of which are
 * drawn as themselves. A character outside that cannot be drawn with one at
 * all and comes out as a question mark; the editor refuses such text before
 * it gets here, saying which character stopped it. Text that needs more than
 * WinAnsi needs an embedded font, which is its own piece of work.
 */
function drawable(text: string): Uint8Array {
  return encodeWinAnsi(text).bytes;
}
