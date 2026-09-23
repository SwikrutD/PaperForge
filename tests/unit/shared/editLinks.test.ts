import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { PdfLibMutationEngine } from '../../../src/pdf/mutate/pdfLibEngine';
import { linksOnPage } from '../../../src/pdf/mutate/links';
import type { LinkModel } from '../../../src/shared/schemas/link';
import { linkUrlSchema } from '../../../src/shared/schemas/link';
import { buildPdf } from '../../fixtures/pdf';

/**
 * Links: a rectangle with somewhere to go. PaperForge writes a page
 * destination or a web address, and describes anything else it finds without
 * following it.
 */

const engine = new PdfLibMutationEngine();

function documentOf(): Uint8Array {
  return new Uint8Array(buildPdf({ pages: [{ text: 'One' }, { text: 'Two' }] }));
}

async function linksOf(bytes: Uint8Array, page = 1): Promise<LinkModel[]> {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  return linksOnPage(document, page - 1);
}

const rect = { x: 100, y: 500, width: 200, height: 40 };

describe('making a link', () => {
  it('writes one that points at a web address', async () => {
    const result = await engine.apply(documentOf(), [
      { kind: 'addLink', page: 1, rect, target: { kind: 'url', url: 'https://example.org/docs' } },
    ]);

    const [link] = await linksOf(result.bytes);
    expect(link?.rect).toEqual(rect);
    expect(link?.target).toEqual({ kind: 'url', url: 'https://example.org/docs' });
    expect(link?.added).toBe(true);
  });

  it('writes one that points at another page of the same document', async () => {
    const result = await engine.apply(documentOf(), [
      { kind: 'addLink', page: 1, rect, target: { kind: 'page', page: 2 } },
    ]);

    const [link] = await linksOf(result.bytes);
    expect(link?.target).toEqual({ kind: 'page', page: 2 });
  });

  it('gives each one a name of its own', async () => {
    let bytes = documentOf();
    for (let round = 0; round < 3; round += 1) {
      const result = await engine.apply(bytes, [
        { kind: 'addLink', page: 1, rect, target: { kind: 'page', page: 2 } },
      ]);
      bytes = result.bytes;
    }

    const names = new Set((await linksOf(bytes)).map((link) => link.id));
    expect(names.size).toBe(3);
  });
});

describe('changing a link', () => {
  it('moves it without changing where it goes', async () => {
    const made = await engine.apply(documentOf(), [
      { kind: 'addLink', page: 1, rect, target: { kind: 'url', url: 'https://example.org/' } },
    ]);
    const [before] = await linksOf(made.bytes);

    const moved = await engine.apply(made.bytes, [
      {
        kind: 'updateLink',
        page: 1,
        linkId: before?.id ?? '',
        rect: { x: 50, y: 60, width: 120, height: 24 },
        target: null,
      },
    ]);

    const [after] = await linksOf(moved.bytes);
    expect(after?.rect).toEqual({ x: 50, y: 60, width: 120, height: 24 });
    expect(after?.target).toEqual({ kind: 'url', url: 'https://example.org/' });
    // It is the same link, not a second one.
    expect(after?.id).toBe(before?.id);
  });

  it('points it somewhere else without moving it', async () => {
    const made = await engine.apply(documentOf(), [
      { kind: 'addLink', page: 1, rect, target: { kind: 'url', url: 'https://example.org/' } },
    ]);
    const [before] = await linksOf(made.bytes);

    const pointed = await engine.apply(made.bytes, [
      {
        kind: 'updateLink',
        page: 1,
        linkId: before?.id ?? '',
        rect: null,
        target: { kind: 'page', page: 2 },
      },
    ]);

    const [after] = await linksOf(pointed.bytes);
    expect(after?.rect).toEqual(rect);
    expect(after?.target).toEqual({ kind: 'page', page: 2 });
  });

  it('takes one off the page', async () => {
    const made = await engine.apply(documentOf(), [
      { kind: 'addLink', page: 1, rect, target: { kind: 'page', page: 2 } },
    ]);
    const [link] = await linksOf(made.bytes);

    const removed = await engine.apply(made.bytes, [
      { kind: 'deleteLink', page: 1, linkId: link?.id ?? '' },
    ]);
    expect(await linksOf(removed.bytes)).toHaveLength(0);
  });

  it('refuses a link that is no longer there', async () => {
    await expect(
      engine.apply(documentOf(), [{ kind: 'deleteLink', page: 1, linkId: 'PFLink9' }]),
    ).rejects.toThrow(/no longer on the page/i);
  });
});

describe('links the document came with', () => {
  it('reads an address, and says where a launch action goes without following it', async () => {
    const bytes = new Uint8Array(
      buildPdf({
        pages: [
          {
            text: 'One',
            annotations: [
              '<< /Type /Annot /Subtype /Link /Rect [ 10 20 110 60 ] ' +
                '/A << /S /URI /URI (https://example.com/a) >> >>',
              '<< /Type /Annot /Subtype /Link /Rect [ 10 100 110 140 ] ' +
                '/A << /S /Launch /F (payload.exe) >> >>',
            ],
          },
        ],
      }),
    );

    const links = await linksOf(bytes);
    expect(links).toHaveLength(2);
    expect(links[0]?.target).toEqual({ kind: 'url', url: 'https://example.com/a' });
    expect(links[0]?.added).toBe(false);
    expect(links[1]?.target).toEqual({
      kind: 'other',
      description: 'Opens a file on the computer',
    });
  });

  it('will not write a target it cannot describe honestly', async () => {
    await expect(
      engine.apply(documentOf(), [
        {
          kind: 'addLink',
          page: 1,
          rect,
          // Only the two PaperForge writes are allowed; this is what an
          // unknown action would be read back as.
          target: { kind: 'other', description: 'An action of type Launch' },
        },
      ]),
    ).rejects.toThrow(/page or at a web address/i);
  });
});

describe('the addresses a link may carry', () => {
  it('takes the web and mail schemes, and nothing else', () => {
    expect(linkUrlSchema.safeParse('https://example.org').success).toBe(true);
    expect(linkUrlSchema.safeParse('http://example.org/a?b=c').success).toBe(true);
    expect(linkUrlSchema.safeParse('mailto:someone@example.org').success).toBe(true);

    expect(linkUrlSchema.safeParse('javascript:alert(1)').success).toBe(false);
    expect(linkUrlSchema.safeParse('file:///C:/Windows/System32').success).toBe(false);
    expect(linkUrlSchema.safeParse('example.org').success).toBe(false);
  });
});
