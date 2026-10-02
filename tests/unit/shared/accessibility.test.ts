import { describe, expect, it } from 'vitest';
import { PdfLibMutationEngine } from '../../../src/pdf/mutate/pdfLibEngine';
import { readSecuritySummary } from '../../../src/pdf/security/summary';
import { markedStates } from '../../../src/pdf/accessibility/markedContent';
import { parseContent } from '../../../src/pdf/content/parser';
import type {
  AccessibilityCheck,
  AccessibilityCheckId,
  AccessibilityReport,
} from '../../../src/shared/schemas/accessibility';
import { languageTagSchema } from '../../../src/shared/schemas/accessibility';
import type { EditOperation } from '../../../src/shared/schemas/edit';
import { buildPdf } from '../../fixtures/pdf';
import { buildFormPdf } from '../../fixtures/forms';
import { buildTaggedPdf } from '../../fixtures/tagged';

const engine = new PdfLibMutationEngine();

async function check(bytes: Uint8Array): Promise<Omit<AccessibilityReport, 'revision'>> {
  return engine.checkAccessibility(bytes, readSecuritySummary(bytes));
}

function find(
  report: Omit<AccessibilityReport, 'revision'>,
  id: AccessibilityCheckId,
): AccessibilityCheck {
  const found = report.checks.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`no ${id} check`);
  return found;
}

async function apply(bytes: Uint8Array, operations: EditOperation[]): Promise<Uint8Array> {
  return (await engine.apply(bytes, operations)).bytes;
}

describe('marked content', () => {
  it('knows which identifier each operation is drawn under, and what is decoration', () => {
    const operations = parseContent(
      new TextEncoder().encode(
        '/P <</MCID 3>> BDC BT (a) Tj ET EMC /Artifact BMC BT (b) Tj ET EMC BT (c) Tj ET',
      ),
    );
    const states = markedStates(operations);
    const shows = operations
      .map((operation, index) => ({ operation, state: states[index] }))
      .filter((entry) => entry.operation.operator === 'Tj')
      .map((entry) => entry.state);

    expect(shows).toEqual([
      { mcid: 3, artifact: false },
      { mcid: null, artifact: true },
      { mcid: null, artifact: false },
    ]);
  });

  it('resolves a named property list to its identifier', () => {
    const operations = parseContent(new TextEncoder().encode('/Span /MC0 BDC BT (a) Tj ET EMC'));
    const states = markedStates(operations, (name) => (name === 'MC0' ? 7 : null));
    expect(states.find((state) => state.mcid !== null)?.mcid).toBe(7);
  });
});

describe('the Accessibility Check', () => {
  it('fails an untagged, untitled document on what it can see, and leaves judgement to a person', async () => {
    const report = await check(buildPdf({ pages: [{ text: 'Hello' }] }));

    expect(report.tagged).toBe(false);
    expect(find(report, 'title').status).toBe('failed');
    expect(find(report, 'language').status).toBe('failed');
    expect(find(report, 'tagged').status).toBe('failed');
    expect(find(report, 'displayTitle').status).toBe('warning');
    // Nothing to judge without tags, rather than a pass.
    expect(find(report, 'figureAltText').status).toBe('notApplicable');
    expect(find(report, 'tabOrder').status).toBe('notApplicable');
    expect(find(report, 'readingOrder').status).toBe('manual');
    expect(find(report, 'colourContrast').status).toBe('manual');
    expect(find(report, 'imageOnlyPages').status).toBe('passed');
  });

  it('reads a tagged document: its tree, its figures, its loose text and its links', async () => {
    const report = await check(
      await buildTaggedPdf({ lang: 'en-GB', title: 'Annual report', displayTitle: true }),
    );

    expect(report.tagged).toBe(true);
    expect(find(report, 'title').status).toBe('passed');
    expect(find(report, 'language').status).toBe('passed');
    expect(find(report, 'displayTitle').status).toBe('passed');
    expect(find(report, 'tagged').status).toBe('passed');

    const figures = find(report, 'figureAltText');
    expect(figures.status).toBe('failed');
    expect(figures.summary).toBe('1 of 2 figures has no alternate text.');
    // The one to fix comes first, located on its page by its own drawing.
    expect(figures.items[0]).toMatchObject({
      page: 1,
      target: { kind: 'figure', path: '0.2', type: 'Figure', alt: null },
      rect: { x: 60, y: 450, width: 120, height: 90 },
    });
    expect(figures.items[1]?.target).toMatchObject({ alt: 'A black square' });

    expect(find(report, 'untaggedContent')).toMatchObject({
      status: 'warning',
      items: [{ page: 1 }],
    });
    expect(find(report, 'linkTargets')).toMatchObject({ status: 'failed', items: [{ page: 2 }] });
    expect(find(report, 'linkDescriptions').status).toBe('warning');
    expect(find(report, 'tabOrder')).toMatchObject({ status: 'failed', items: [{ page: 2 }] });
  });

  it('notices a tag tree the document does not declare', async () => {
    const report = await check(await buildTaggedPdf({ marked: false }));
    expect(find(report, 'tagged').status).toBe('warning');
  });

  it('finds pages that are pictures with no text, and stops when text is laid over them', async () => {
    const scan = buildPdf({
      pages: [
        { text: 'Typed page' },
        { content: '', image: { x: 0, y: 0, width: 612, height: 792 } },
      ],
    });
    const report = await check(scan);
    expect(find(report, 'imageOnlyPages')).toMatchObject({
      status: 'failed',
      items: [{ page: 2 }],
    });

    // Recognize Text writes invisible words, which is all a reader needs.
    const recognised = await apply(scan, [
      {
        kind: 'addRecognisedText',
        pages: [
          {
            page: 2,
            imageWidth: 612,
            imageHeight: 792,
            text: 'Invoice',
            confidence: 90,
            words: [
              {
                text: 'Invoice',
                left: 10,
                top: 10,
                width: 80,
                height: 20,
                confidence: 90,
                line: 0,
              },
            ],
          },
        ],
      },
    ]);
    expect(find(await check(recognised), 'imageOnlyPages').status).toBe('passed');
  });

  it('lists fields without a description, and names them when told to', async () => {
    const form = await buildFormPdf({ tooltip: 'Your full name' });
    const before = find(await check(form), 'formFieldNames');
    expect(before.status).toBe('failed');
    expect(before.items.map((item) => item.label)).not.toContain('person.name');
    expect(before.items.map((item) => item.label)).toContain('person.notes');

    const fields = before.items.flatMap((item) =>
      item.target.kind === 'field'
        ? [{ name: item.target.name, tooltip: `About ${item.label}` }]
        : [],
    );
    const named = await apply(form, [{ kind: 'setFieldTooltips', fields }]);
    expect(find(await check(named), 'formFieldNames').status).toBe('passed');
  });

  it('sets the title, the title bar, the language and the tab order', async () => {
    const tagged = await buildTaggedPdf();
    const fixed = await apply(tagged, [
      { kind: 'setDocumentTitle', title: 'Annual report' },
      { kind: 'setDisplayDocTitle', display: true },
      { kind: 'setDocumentLanguage', language: 'en' },
      { kind: 'setTabOrder', pages: null },
    ]);
    const report = await check(fixed);

    expect(report.title).toBe('Annual report');
    expect(report.language).toBe('en');
    expect(find(report, 'title').status).toBe('passed');
    expect(find(report, 'displayTitle').status).toBe('passed');
    expect(find(report, 'tabOrder').status).toBe('passed');
  });

  it('writes alternate text to the element it was asked about, and refuses a stale path', async () => {
    const tagged = await buildTaggedPdf();
    const fixed = await apply(tagged, [
      { kind: 'setAltText', path: '0.2', expectedType: 'Figure', alt: 'Sales by region, 2024' },
    ]);
    const figures = find(await check(fixed), 'figureAltText');
    expect(figures.status).toBe('passed');
    expect(figures.items.map((item) => item.target)).toContainEqual(
      expect.objectContaining({ path: '0.2', alt: 'Sales by region, 2024' }),
    );

    await expect(
      apply(tagged, [{ kind: 'setAltText', path: '0.1', expectedType: 'Figure', alt: 'x' }]),
    ).rejects.toMatchObject({ code: 'internal/unexpected' });
  });

  it('reports a document that forbids assistive technology', async () => {
    const report = await engine.checkAccessibility(buildPdf({ pages: [{ text: 'x' }] }), {
      ...readSecuritySummary(buildPdf({ pages: [{}] })),
      encrypted: true,
      permissions: {
        print: 'full',
        modify: 'none',
        extract: false,
        extractForAccessibility: false,
        fillForms: true,
        annotate: false,
        assemble: false,
      },
    });
    expect(find(report, 'assistivePermission').status).toBe('failed');
  });
});

describe('reading order', () => {
  it('numbers each element that owns content on the page, in the order of the tree', async () => {
    const order = await engine.readReadingOrder(await buildTaggedPdf(), 1);

    expect(order.tagged).toBe(true);
    expect(order.regions.map((region) => [region.order, region.type])).toEqual([
      [1, 'H1'],
      [2, 'P'],
      [3, 'Figure'],
    ]);
    expect(order.regions[2]?.rect).toEqual({ x: 60, y: 450, width: 120, height: 90 });
    // The loose line is reported; the page number, marked as decoration, is not.
    expect(order.untagged).toHaveLength(1);
    expect(order.untagged[0]?.x).toBe(300);
  });

  it('has nothing to show for a document without tags', async () => {
    const order = await engine.readReadingOrder(buildPdf({ pages: [{ text: 'x' }] }), 1);
    expect(order).toEqual({ page: 1, tagged: false, regions: [], untagged: [] });
  });
});

describe('language tags', () => {
  it('accepts the shapes BCP 47 allows and refuses prose', () => {
    expect(languageTagSchema.safeParse('en').success).toBe(true);
    expect(languageTagSchema.safeParse('zh-Hant-TW').success).toBe(true);
    expect(languageTagSchema.safeParse('en GB').success).toBe(false);
    expect(languageTagSchema.safeParse('e').success).toBe(false);
  });
});
