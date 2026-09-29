import { describe, expect, it } from 'vitest';
import { PdfLibMutationEngine } from '../../../src/pdf/mutate/pdfLibEngine';
import { parsePdfDate } from '../../../src/pdf/metadata/read';
import type { EditOperation } from '../../../src/shared/schemas/edit';
import { EMPTY_METADATA } from '../../../src/shared/schemas/metadata';
import { buildPdf } from '../../fixtures/pdf';

const engine = new PdfLibMutationEngine();

async function applyAndRead(
  bytes: Uint8Array,
  operations: EditOperation[],
): Promise<Awaited<ReturnType<typeof engine.readProperties>>> {
  const result = await engine.apply(bytes, operations);
  return engine.readProperties(result.bytes);
}

const DOCUMENT = (): Buffer =>
  buildPdf({
    pages: [{ text: 'One' }, { text: 'Two' }],
    info: {
      Title: 'Quarterly report',
      Author: 'A. Writer',
      Producer: 'Some other program',
      CreationDate: "D:20240312094100+01'00'",
      Department: 'Finance',
    },
    xmp: '<?xpacket begin="" ?><x:xmpmeta xmlns:x="adobe:ns:meta/"/><?xpacket end="r"?>',
  });

describe('document properties', () => {
  it('reads what the document says about itself', async () => {
    const properties = await engine.readProperties(DOCUMENT());

    expect(properties.metadata.title).toBe('Quarterly report');
    expect(properties.metadata.author).toBe('A. Writer');
    expect(properties.metadata.producer).toBe('Some other program');
    expect(properties.pageCount).toBe(2);
    expect(properties.hasXmpMetadata).toBe(true);
    expect(properties.tagged).toBe(false);
  });

  it('separates custom entries from the standard ones', async () => {
    const properties = await engine.readProperties(DOCUMENT());

    expect(properties.custom).toEqual([{ name: 'Department', value: 'Finance' }]);
    expect(properties.metadata.subject).toBeNull();
  });

  it('reads the creation date as a moment in time, allowing for its offset', async () => {
    const properties = await engine.readProperties(DOCUMENT());

    // 09:41 at +01:00 is 08:41 UTC.
    expect(properties.metadata.createdAt).toBe('2024-03-12T08:41:00.000Z');
  });

  it('groups page sizes and states them with rotation applied', async () => {
    const bytes = buildPdf({
      pages: [{}, {}, { width: 200, height: 400, rotate: 90 }],
    });
    const properties = await engine.readProperties(bytes);

    expect(properties.pageSizes).toEqual([
      { width: 612, height: 792, pageCount: 2 },
      { width: 400, height: 200, pageCount: 1 },
    ]);
  });

  it('lists the fonts the pages name, saying which travel with the document', async () => {
    const properties = await engine.readProperties(DOCUMENT());

    expect(properties.fonts).toHaveLength(1);
    expect(properties.fonts[0]).toMatchObject({
      name: 'Helvetica',
      type: 'Type1',
      embedded: false,
      encoding: 'WinAnsiEncoding',
    });
  });
});

describe('writing document properties', () => {
  it('changes the fields that were given and leaves the rest', async () => {
    const properties = await applyAndRead(DOCUMENT(), [
      {
        kind: 'setMetadata',
        metadata: {
          ...EMPTY_METADATA,
          title: 'Renamed',
          author: 'A. Writer',
          subject: 'Results',
        },
        custom: [{ name: 'Department', value: 'Finance' }],
        removeXmpMetadata: false,
      },
    ]);

    expect(properties.metadata.title).toBe('Renamed');
    expect(properties.metadata.subject).toBe('Results');
    expect(properties.custom).toEqual([{ name: 'Department', value: 'Finance' }]);
  });

  /**
   * A cleared text box means "this document has no author", which is not the
   * same as an author who is the empty string.
   */
  it('removes an entry rather than writing an empty one', async () => {
    const properties = await applyAndRead(DOCUMENT(), [
      {
        kind: 'setMetadata',
        metadata: { ...EMPTY_METADATA, title: 'Renamed' },
        custom: [],
        removeXmpMetadata: false,
      },
    ]);

    expect(properties.metadata.author).toBeNull();
    expect(properties.metadata.producer).toBeNull();
    expect(properties.custom).toEqual([]);
  });

  it('keeps non-Latin text intact through a save and a reread', async () => {
    const properties = await applyAndRead(DOCUMENT(), [
      {
        kind: 'setMetadata',
        metadata: { ...EMPTY_METADATA, title: 'Отчёт — 概要', author: 'Ünal Çelik' },
        custom: [{ name: 'Note', value: 'διαθέσιμο' }],
        removeXmpMetadata: false,
      },
    ]);

    expect(properties.metadata.title).toBe('Отчёт — 概要');
    expect(properties.metadata.author).toBe('Ünal Çelik');
    expect(properties.custom).toEqual([{ name: 'Note', value: 'διαθέσιμο' }]);
  });

  it('takes the XMP packet out when asked, so the two cannot disagree', async () => {
    const properties = await applyAndRead(DOCUMENT(), [
      {
        kind: 'setMetadata',
        metadata: { ...EMPTY_METADATA, title: 'Renamed' },
        custom: [],
        removeXmpMetadata: true,
      },
    ]);

    expect(properties.hasXmpMetadata).toBe(false);
    expect(properties.metadata.title).toBe('Renamed');
  });

  it('sets and clears the document language', async () => {
    const withLanguage = await engine.apply(DOCUMENT(), [
      { kind: 'setDocumentLanguage', language: 'en-GB' },
    ]);
    expect((await engine.readProperties(withLanguage.bytes)).language).toBe('en-GB');

    const cleared = await engine.apply(withLanguage.bytes, [
      { kind: 'setDocumentLanguage', language: null },
    ]);
    expect((await engine.readProperties(cleared.bytes)).language).toBeNull();
  });

  it('writes dates a reader can read back', async () => {
    const properties = await applyAndRead(DOCUMENT(), [
      {
        kind: 'setMetadata',
        metadata: { ...EMPTY_METADATA, modifiedAt: '2025-01-02T03:04:05.000Z' },
        custom: [],
        removeXmpMetadata: false,
      },
    ]);

    expect(properties.metadata.modifiedAt).toBe('2025-01-02T03:04:05.000Z');
  });
});

describe('PDF dates', () => {
  it('reads the shapes a PDF date can take', () => {
    expect(parsePdfDate('D:2024')?.toISOString()).toBe('2024-01-01T00:00:00.000Z');
    expect(parsePdfDate('D:20240312094100Z')?.toISOString()).toBe('2024-03-12T09:41:00.000Z');
    expect(parsePdfDate("D:20240312094100-05'00'")?.toISOString()).toBe('2024-03-12T14:41:00.000Z');
    // Some writers leave off the D: prefix entirely.
    expect(parsePdfDate('20240312')?.toISOString()).toBe('2024-03-12T00:00:00.000Z');
  });

  it('returns null rather than a guess for something unreadable', () => {
    expect(parsePdfDate('sometime last year')).toBeNull();
    expect(parsePdfDate('')).toBeNull();
  });
});
