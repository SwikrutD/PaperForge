import { PDFDocument } from 'pdf-lib';
import { AppError } from '@shared/errors/appError';
import type { PageTextModel, TextColor, TextRunModel } from '@shared/schemas/text';
import { readPageContent } from '@pdf/content/pageContent';
import { encodeForFont, rewritability } from '@pdf/content/editText';
import { runBounds, seenFontSize, type TextRun } from '@pdf/content/textRuns';
import { findRun, runIdOf } from '@pdf/mutate/text';
import { isReplacementFont } from '@pdf/mutate/textResources';
import type { Color } from '@pdf/content/state';
import type { DocumentEditor } from '../../services/documents/documentEditor';
import type { RegisterInvoke } from '../registry';

export interface TextHandlerDeps {
  editor: DocumentEditor;
}

/**
 * What the text editor needs to know about a page.
 *
 * The model is read from the revision being shown, and carries the revision
 * it came from: a run's id holds only for that revision, because every change
 * rewrites the page's content.
 */
export function registerTextHandlers(registerInvoke: RegisterInvoke, deps: TextHandlerDeps): void {
  registerInvoke('text:page', async ({ sessionId, page }) => {
    const bytes = await deps.editor.currentBytes(sessionId);
    const revision = deps.editor.revisionOf(sessionId);

    let document: PDFDocument;
    try {
      document = await PDFDocument.load(bytes, { updateMetadata: false });
    } catch (error) {
      throw new AppError('pdf/invalid', {
        message: 'That document could not be read for editing.',
        cause: error,
      });
    }

    if (page < 1 || page > document.getPageCount()) {
      throw new AppError('internal/unexpected', {
        message: 'That page is not in this document.',
        details: `page ${String(page)} of ${String(document.getPageCount())}`,
      });
    }

    const content = await readPageContent(document, page - 1);
    const model: PageTextModel = {
      page,
      revision,
      // A run whose font will not say what its characters are still exists on
      // the page: it is listed, with nothing to read and a reason why.
      runs: content.runs.filter((run) => run.glyphs.length > 0).map(describeRun),
    };
    return model;
  });

  /**
   * Asked before a change is sent, so the editor can offer to replace the text
   * instead of failing after the fact.
   */
  registerInvoke('text:canWrite', async ({ sessionId, page, runId, text }) => {
    const bytes = await deps.editor.currentBytes(sessionId);
    const document = await PDFDocument.load(bytes, { updateMetadata: false });
    if (page < 1 || page > document.getPageCount()) return { ok: false, missing: null };

    const content = await readPageContent(document, page - 1);
    const run = findRun(content, runId);
    if (run?.font === undefined || run.font === null) return { ok: false, missing: null };
    if (!rewritability(run).editable) return { ok: false, missing: null };

    const encoded = encodeForFont(run.font, text);
    return encoded.ok ? { ok: true, missing: null } : { ok: false, missing: encoded.missing };
  });
}

function describeRun(run: TextRun): TextRunModel {
  const bounds = runBounds(run);
  const verdict = rewritability(run);

  return {
    id: runIdOf(run),
    text: run.text,
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    baselineX: run.origin.x,
    baselineY: run.origin.y,
    rotation: run.rotation,
    fontName: run.fontName ?? '',
    baseFont: run.font?.baseFont ?? 'Unknown',
    fontSize: seenFontSize(run),
    color: toRgb(run.color),
    invisible: run.invisible,
    editable: verdict.editable,
    reason: verdict.reason ?? null,
    replaced: isReplacementFont(run.fontName),
  };
}

/** Whatever space the page drew in, as something a screen can show. */
function toRgb(color: Color): TextColor {
  const [first = 0, second = 0, third = 0, fourth = 0] = color.components;

  if (color.space === 'gray') return { r: clamp(first), g: clamp(first), b: clamp(first) };
  if (color.space === 'rgb') return { r: clamp(first), g: clamp(second), b: clamp(third) };
  if (color.space === 'cmyk') {
    return {
      r: clamp((1 - first) * (1 - fourth)),
      g: clamp((1 - second) * (1 - fourth)),
      b: clamp((1 - third) * (1 - fourth)),
    };
  }
  // A colour in a space PaperForge does not resolve is shown as black, which
  // is what most of them are.
  return { r: 0, g: 0, b: 0 };
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
