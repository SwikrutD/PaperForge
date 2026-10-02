import { describe, expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PdfLibMutationEngine } from '../../../src/pdf/mutate/pdfLibEngine';
import { orderRows } from '../../../src/pdf/render/layerOrder';
import { buildPdf } from '../../fixtures/pdf';

const engine = new PdfLibMutationEngine();

/** Which layers PDF.js shows when it opens the document, by name. */
async function shownWhenOpened(bytes: Uint8Array): Promise<Record<string, boolean>> {
  const task = getDocument({ data: new Uint8Array(bytes) });
  const document = await task.promise;
  const config = await document.getOptionalContentConfig();
  const shown: Record<string, boolean> = {};
  for (const [, group] of config as unknown as Iterable<
    [string, { name: string; visible: boolean }]
  >) {
    shown[group.name] = group.visible;
  }
  await task.destroy();
  return shown;
}

describe('layers', () => {
  it('flattens the display order with headings and nesting', () => {
    expect(
      orderRows(['1R', { name: 'Plans', order: ['2R', { name: null, order: ['3R'] }] }, '4R'], 0),
    ).toEqual([
      { id: '1R', depth: 0 },
      { heading: 'Plans', depth: 0 },
      { id: '2R', depth: 1 },
      { id: '3R', depth: 2 },
      { id: '4R', depth: 0 },
    ]);
  });

  it('saves which layers show when the document is opened', async () => {
    const bytes = buildPdf({ pages: [{ text: 'x', layer: 'Notes' }], layers: ['Notes', 'Grid'] });
    expect(await shownWhenOpened(bytes)).toEqual({ Notes: true, Grid: true });

    // The fixture writes the groups as objects 4 and 5.
    const result = await engine.apply(bytes, [
      {
        kind: 'setLayerDefaults',
        layers: [
          { id: '4R', visible: true },
          { id: '5R', visible: false },
        ],
      },
    ]);
    expect(await shownWhenOpened(result.bytes)).toEqual({ Notes: true, Grid: false });
  });

  it('refuses a layer the document does not have', async () => {
    const bytes = buildPdf({ pages: [{}], layers: ['Notes'] });
    await expect(
      engine.apply(bytes, [{ kind: 'setLayerDefaults', layers: [{ id: '99R', visible: false }] }]),
    ).rejects.toMatchObject({ message: 'That layer is no longer in this document.' });
  });
});
