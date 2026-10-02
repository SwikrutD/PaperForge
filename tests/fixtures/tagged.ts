import { PDFDocument, PDFHexString, PDFName, PDFNumber, PDFString, type PDFRef } from 'pdf-lib';
import { buildPdf, type PageSpec } from './pdf';

/**
 * Tagged documents: pages that draw their content in marked-content brackets,
 * and a tag tree that owns those brackets.
 *
 * Page 1 has a heading (written under a custom type the role map resolves), a
 * paragraph, a figure drawn as a filled path, a page number marked as
 * decoration and one line of text the tags never mention. Page 2 has a second
 * figure, and a link.
 */

export interface TaggedOptions {
  /** Alternate text of the first figure; null leaves it without any. */
  firstFigureAlt?: string | null;
  /** Declares the document tagged in /MarkInfo. True by default. */
  marked?: boolean;
  /** Writes /Tabs /S on every page. */
  structureTabs?: boolean;
  lang?: string;
  title?: string;
  displayTitle?: boolean;
}

const PAGE_ONE =
  '/Heading1 <</MCID 0>> BDC BT /F1 24 Tf 1 0 0 1 60 700 Tm (Annual report) Tj ET EMC\n' +
  '/P <</MCID 1>> BDC BT /F1 12 Tf 1 0 0 1 60 650 Tm (Body text of the report.) Tj ET EMC\n' +
  '/Figure <</MCID 2>> BDC q 0.2 0.4 0.8 rg 60 450 120 90 re f Q EMC\n' +
  '/Artifact BMC BT /F1 9 Tf 1 0 0 1 300 30 Tm (1) Tj ET EMC\n' +
  'BT /F1 12 Tf 1 0 0 1 300 300 Tm (Loose text) Tj ET\n';

const PAGE_TWO =
  '/P <</MCID 0>> BDC BT /F1 12 Tf 1 0 0 1 60 700 Tm (Second page.) Tj ET EMC\n' +
  '/Figure <</MCID 1>> BDC q 0 0 0 rg 200 400 50 50 re f Q EMC\n';

export async function buildTaggedPdf(options: TaggedOptions = {}): Promise<Uint8Array> {
  const pages: PageSpec[] = [
    { content: PAGE_ONE },
    {
      content: PAGE_TWO,
      annotations: ['<< /Type /Annot /Subtype /Link /Rect [60 690 160 712] /Border [0 0 0] >>'],
    },
  ];
  const document = await PDFDocument.load(buildPdf({ pages }));
  const context = document.context;
  const [first, second] = document.getPages();
  if (first === undefined || second === undefined) throw new Error('fixture has two pages');

  const rootRef = context.nextRef();
  const documentRef = context.nextRef();

  const element = (
    type: string,
    page: PDFRef,
    kids: number | PDFRef[],
    extra: Record<string, PDFString | PDFHexString> = {},
  ): PDFRef =>
    context.register(
      context.obj({
        Type: 'StructElem',
        S: type,
        P: documentRef,
        Pg: page,
        K: typeof kids === 'number' ? PDFNumber.of(kids) : kids,
        ...extra,
      }),
    );

  const heading = element('Heading1', first.ref, 0);
  const paragraph = element('P', first.ref, 1);
  const figureOne = element(
    'Figure',
    first.ref,
    2,
    options.firstFigureAlt === null || options.firstFigureAlt === undefined
      ? {}
      : { Alt: PDFHexString.fromText(options.firstFigureAlt) },
  );
  const paragraphTwo = element('P', second.ref, 0);
  const figureTwo = element('Figure', second.ref, 1, {
    Alt: PDFString.of('A black square'),
  });

  context.assign(
    documentRef,
    context.obj({
      Type: 'StructElem',
      S: 'Document',
      P: rootRef,
      K: [heading, paragraph, figureOne, paragraphTwo, figureTwo],
    }),
  );
  context.assign(
    rootRef,
    context.obj({ Type: 'StructTreeRoot', K: documentRef, RoleMap: { Heading1: 'H1' } }),
  );
  document.catalog.set(PDFName.of('StructTreeRoot'), rootRef);

  if (options.marked !== false) {
    document.catalog.set(PDFName.of('MarkInfo'), context.obj({ Marked: true }));
  }
  if (options.lang !== undefined) {
    document.catalog.set(PDFName.of('Lang'), PDFString.of(options.lang));
  }
  if (options.title !== undefined) document.setTitle(options.title);
  if (options.displayTitle === true) {
    document.catalog.set(PDFName.of('ViewerPreferences'), context.obj({ DisplayDocTitle: true }));
  }
  if (options.structureTabs === true) {
    for (const page of document.getPages()) page.node.set(PDFName.of('Tabs'), PDFName.of('S'));
  }

  return document.save({ useObjectStreams: false });
}
