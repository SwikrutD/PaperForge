import { PDFDocument, PDFName, type PDFRef, type PDFDict } from 'pdf-lib';
import { pngPixel } from './images';

/**
 * Pages whose pictures are drawn from inside form XObjects.
 *
 * Producers that place a logo, a letterhead or a scanned page through a form
 * draw the picture from the form's own content stream, against the form's own
 * resources and matrix. These are built with pdf-lib so the tests own every
 * byte they assert on.
 */

export interface FormSpec {
  /** The form's own content stream. */
  content: string;
  /** `/Matrix`, defaulting to the identity. */
  matrix?: [number, number, number, number, number, number];
  bbox?: [number, number, number, number];
  /** XObjects the form's resources name: a form's name, or `'image'` for the shared picture. */
  xobjects?: Record<string, string>;
  /** Leave the form without resources of its own. */
  noResources?: boolean;
}

export interface FormPdfSpec {
  forms: Record<string, FormSpec>;
  /** Page content and the forms its resources name. */
  pages: Array<{ content: string; xobjects: Record<string, string> }>;
  /** Pixels across and down of the shared picture. */
  pixels?: [number, number];
}

export async function buildFormPdf(spec: FormPdfSpec): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const [width, height] = spec.pixels ?? [4, 2];
  const image = await document.embedPng(pngPixel(width, height));

  // Every form gets its ref first, so forms can name one another.
  const refs = new Map<string, PDFRef>();
  for (const name of Object.keys(spec.forms)) refs.set(name, document.context.nextRef());

  const resourcesFor = (xobjects: Record<string, string>): PDFDict => {
    const entries: Record<string, PDFRef> = {};
    for (const [key, target] of Object.entries(xobjects)) {
      const ref = target === 'image' ? image.ref : refs.get(target);
      if (ref === undefined) throw new Error(`no form called ${target}`);
      entries[key] = ref;
    }
    return document.context.obj({ XObject: entries });
  };

  for (const [name, form] of Object.entries(spec.forms)) {
    const dict: Record<string, unknown> = {
      Type: 'XObject',
      Subtype: 'Form',
      BBox: form.bbox ?? [0, 0, 1000, 1000],
    };
    if (form.matrix !== undefined) dict.Matrix = form.matrix;
    if (form.noResources !== true) dict.Resources = resourcesFor(form.xobjects ?? {});
    const stream = document.context.flateStream(form.content, dict as never);
    document.context.assign(refs.get(name) as PDFRef, stream);
  }

  for (const pageSpec of spec.pages) {
    const page = document.addPage([600, 800]);
    page.node.set(PDFName.of('Resources'), resourcesFor(pageSpec.xobjects));
    page.node.set(
      PDFName.of('Contents'),
      document.context.register(document.context.stream(pageSpec.content)),
    );
  }

  return document.save({ useObjectStreams: false });
}

/** A form that draws the picture 100 by 50, placed on the page at (50, 60). */
export function logoInForm(): Promise<Uint8Array> {
  return buildFormPdf({
    forms: {
      Logo: {
        content: 'q 100 0 0 50 0 0 cm /Im0 Do Q',
        matrix: [1, 0, 0, 1, 10, 20],
        bbox: [0, 0, 200, 100],
        xobjects: { Im0: 'image' },
      },
    },
    pages: [{ content: 'q 1 0 0 1 40 40 cm /Fm0 Do Q', xobjects: { Fm0: 'Logo' } }],
  });
}
