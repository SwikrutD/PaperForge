import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFHexString, PDFName, type PDFObject } from 'pdf-lib';
import { readPageContent } from '../../../src/pdf/content/pageContent';
import type { Color } from '../../../src/pdf/content/state';
import { buildPdf } from '../../fixtures/pdf';

/**
 * Text drawn in a colour space the page names is read in that space. A full
 * tint of a spot ink is ink, not white: reading it as gray 1 opened the
 * editor's field white on a white page, so the text seemed to vanish.
 */

async function colorOfText(
  content: string,
  spaces: (document: PDFDocument) => Record<string, PDFObject>,
): Promise<Color | undefined> {
  const document = await PDFDocument.load(buildPdf({ pages: [{ content }] }));
  const resources = document.getPage(0).node.Resources();
  const dict = document.context.obj({});
  for (const [name, space] of Object.entries(spaces(document))) dict.set(PDFName.of(name), space);
  resources?.set(PDFName.of('ColorSpace'), dict);
  return (await readPageContent(document, 0)).runs[0]?.color;
}

const text = (color: string): string => `${color} BT /F1 12 Tf 60 700 Td (Ink) Tj ET`;

describe('text colour in named colour spaces', () => {
  it('reads a full tint of a spot ink as dark, not white', async () => {
    const color = await colorOfText(text('/CS0 cs 1 scn'), (document) => ({
      CS0: document.context.obj([
        PDFName.of('Separation'),
        PDFName.of('Spot'),
        PDFName.of('DeviceGray'),
        document.context.obj({ FunctionType: 4 }),
      ]),
    }));
    expect(color).toEqual({ space: 'gray', components: [0] });
  });

  it('evaluates an exponential tint transform into its alternate space', async () => {
    const color = await colorOfText(text('/CS0 cs 1 scn'), (document) => ({
      CS0: document.context.obj([
        PDFName.of('Separation'),
        PDFName.of('Red'),
        PDFName.of('DeviceRGB'),
        document.context.obj({
          FunctionType: 2,
          Domain: [0, 1],
          C0: [1, 1, 1],
          C1: [1, 0, 0],
          N: 1,
        }),
      ]),
    }));
    expect(color).toEqual({ space: 'rgb', components: [1, 0, 0] });
  });

  it('reads the Black plate as black ink', async () => {
    const color = await colorOfText(text('/CS0 cs 0.5 scn'), (document) => ({
      CS0: document.context.obj([
        PDFName.of('Separation'),
        PDFName.of('Black'),
        PDFName.of('DeviceCMYK'),
        document.context.obj({ FunctionType: 4 }),
      ]),
    }));
    expect(color).toEqual({ space: 'cmyk', components: [0, 0, 0, 0.5] });
  });

  it('starts a selected spot ink at full tint', async () => {
    const color = await colorOfText(text('/CS0 cs'), (document) => ({
      CS0: document.context.obj([
        PDFName.of('Separation'),
        PDFName.of('All'),
        PDFName.of('DeviceGray'),
        document.context.obj({ FunctionType: 4 }),
      ]),
    }));
    expect(color).toEqual({ space: 'gray', components: [0] });
  });

  it('looks an indexed colour up in its palette', async () => {
    const color = await colorOfText(text('/CS0 cs 1 sc'), (document) => ({
      CS0: document.context.obj([
        PDFName.of('Indexed'),
        PDFName.of('DeviceRGB'),
        1,
        PDFHexString.of('FFFFFF0000FF'),
      ]),
    }));
    expect(color?.space).toBe('rgb');
    expect(color?.components).toEqual([0, 0, 1]);
  });

  it('reads Lab black as black', async () => {
    const color = await colorOfText(text('/CS0 cs 0 0 0 sc'), (document) => ({
      CS0: document.context.obj([
        PDFName.of('Lab'),
        document.context.obj({ WhitePoint: [0.9505, 1, 1.089] }),
      ]),
    }));
    expect(color?.space).toBe('rgb');
    for (const part of color?.components ?? [1]) expect(part).toBeCloseTo(0, 3);
  });

  it('still reads device colours set with rg after a named space', async () => {
    const color = await colorOfText(text('/CS0 cs 1 scn 0.2 0.4 0.6 rg'), (document) => ({
      CS0: document.context.obj([
        PDFName.of('Separation'),
        PDFName.of('Spot'),
        PDFName.of('DeviceGray'),
        document.context.obj({ FunctionType: 4 }),
      ]),
    }));
    expect(color).toEqual({ space: 'rgb', components: [0.2, 0.4, 0.6] });
  });

  it('reads DeviceCMYK named directly', async () => {
    const color = await colorOfText(text('/DeviceCMYK cs 0 0 0 1 sc'), () => ({}));
    expect(color).toEqual({ space: 'cmyk', components: [0, 0, 0, 1] });
  });
});
