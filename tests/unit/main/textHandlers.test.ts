import { describe, expect, it } from 'vitest';
import type { PageTextModel } from '../../../src/shared/schemas/text';
import { registerTextHandlers } from '../../../src/main/ipc/handlers/textHandlers';
import type { RegisterInvoke } from '../../../src/main/ipc/registry';
import type { DocumentEditor } from '../../../src/main/services/documents/documentEditor';
import { buildPdf } from '../../fixtures/pdf';

/**
 * What the text editor is told about a page. A run's size is the size the
 * reader sees: the font size the page sets, scaled by however the text matrix
 * and the page's transform scale it. Many generators draw at `1 Tf` and scale
 * the matrix; the editor must not call that text one point high.
 */

type Handler = (request: { sessionId: string; page: number }) => Promise<PageTextModel>;

function textPage(content: string): Handler {
  const bytes = new Uint8Array(buildPdf({ pages: [{ content }] }));
  const handlers = new Map<string, unknown>();
  const register = ((channel: string, handler: unknown) => {
    handlers.set(channel, handler);
  }) as unknown as RegisterInvoke;
  const editor = {
    currentBytes: () => Promise.resolve(bytes),
    revisionOf: () => 0,
  } as unknown as DocumentEditor;

  registerTextHandlers(register, { editor });
  return handlers.get('text:page') as Handler;
}

describe('the size a run is reported at', () => {
  it('is the font size scaled by the text matrix', async () => {
    const read = textPage('BT /F1 1 Tf 12 0 0 12 60 700 Tm (scaled) Tj ET');
    const model = await read({ sessionId: 's', page: 1 });
    expect(model.runs[0]?.fontSize).toBeCloseTo(12, 4);
  });

  it('includes what the page transform scales it by', async () => {
    const read = textPage('2 0 0 2 0 0 cm BT /F1 9 Tf 30 350 Td (doubled) Tj ET');
    const model = await read({ sessionId: 's', page: 1 });
    expect(model.runs[0]?.fontSize).toBeCloseTo(18, 4);
  });

  it('is the font size itself when nothing scales it', async () => {
    const read = textPage('BT /F1 14 Tf 60 700 Td (plain) Tj ET');
    const model = await read({ sessionId: 's', page: 1 });
    expect(model.runs[0]?.fontSize).toBeCloseTo(14, 4);
  });
});
