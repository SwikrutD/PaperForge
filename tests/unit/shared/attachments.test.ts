import { describe, expect, it } from 'vitest';
import { PdfLibMutationEngine } from '../../../src/pdf/mutate/pdfLibEngine';
import type { StagedAsset } from '../../../src/pdf/mutate/types';
import { isRiskyAttachmentName } from '../../../src/shared/schemas/attachment';
import { buildPdf } from '../../fixtures/pdf';

const engine = new PdfLibMutationEngine();

function stagedFile(
  fileName: string,
  contents: string,
  mimeType: string | null = null,
): {
  assets: Map<string, StagedAsset>;
  token: string;
} {
  const token = `file-${fileName}`;
  const assets = new Map<string, StagedAsset>([
    [
      token,
      {
        kind: 'file',
        bytes: new TextEncoder().encode(contents),
        fileName,
        mimeType,
        modifiedAt: new Date('2024-05-06T07:08:09.000Z'),
      },
    ],
  ]);
  return { assets, token };
}

describe('reading attachments', () => {
  it('lists the files a document carries, with what it says about them', async () => {
    const bytes = buildPdf({
      pages: [{ text: 'Cover' }],
      attachments: [
        { fileName: 'notes.txt', content: 'hello there', description: 'Meeting notes' },
      ],
    });

    const attachments = await engine.readAttachments(bytes);
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({
      fileName: 'notes.txt',
      description: 'Meeting notes',
      sizeBytes: 11,
      risky: false,
    });
  });

  it('marks a file Windows would run', async () => {
    const bytes = buildPdf({
      pages: [{ text: 'Cover' }],
      attachments: [{ fileName: 'setup.exe', content: 'MZ' }],
    });

    expect((await engine.readAttachments(bytes))[0]?.risky).toBe(true);
  });

  it('finds an attachment pinned to a page as well as one in the name tree', async () => {
    const bytes = buildPdf({
      pages: [
        {
          text: 'Cover',
          annotations: [
            '<< /Type /Annot /Subtype /FileAttachment /Rect [10 10 30 30] ' +
              '/FS << /Type /Filespec /F (pinned.txt) /UF (pinned.txt) >> >>',
          ],
        },
      ],
      attachments: [{ fileName: 'listed.txt', content: 'in the tree' }],
    });

    const names = (await engine.readAttachments(bytes)).map((entry) => entry.fileName);
    expect(names).toContain('listed.txt');
    expect(names).toContain('pinned.txt');
  });
});

describe('adding and removing attachments', () => {
  it('embeds a file that reads back with its name and bytes', async () => {
    const { assets, token } = stagedFile('report.txt', 'the whole report', 'text/plain');
    const result = await engine.apply(
      buildPdf({ pages: [{ text: 'Cover' }] }),
      [{ kind: 'addAttachments', tokens: [token] }],
      assets,
    );

    const attachments = await engine.readAttachments(result.bytes);
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({
      fileName: 'report.txt',
      sizeBytes: 16,
      mimeType: 'text/plain',
      modifiedAt: '2024-05-06T07:08:09.000Z',
    });

    const extracted = await engine.extractAttachment(result.bytes, attachments[0]?.id ?? '');
    expect(new TextDecoder().decode(extracted?.bytes)).toBe('the whole report');
  });

  it('keeps a name that is not plain ASCII', async () => {
    const { assets, token } = stagedFile('résumé — 概要.txt', 'contents');
    const result = await engine.apply(
      buildPdf({ pages: [{ text: 'Cover' }] }),
      [{ kind: 'addAttachments', tokens: [token] }],
      assets,
    );

    expect((await engine.readAttachments(result.bytes))[0]?.fileName).toBe('résumé — 概要.txt');
  });

  it('takes an attachment out and leaves the others', async () => {
    const bytes = buildPdf({
      pages: [{ text: 'Cover' }],
      attachments: [
        { fileName: 'keep.txt', content: 'stay' },
        { fileName: 'drop.txt', content: 'go' },
      ],
    });

    const result = await engine.apply(bytes, [{ kind: 'removeAttachments', ids: ['drop.txt'] }]);
    const names = (await engine.readAttachments(result.bytes)).map((entry) => entry.fileName);

    expect(names).toEqual(['keep.txt']);
  });

  /**
   * Removing an attachment must remove its bytes, not just the listing. A
   * full rewrite is what makes that true, and it is worth asserting rather
   * than assuming.
   */
  it('leaves no trace of the bytes of a removed attachment', async () => {
    const bytes = buildPdf({
      pages: [{ text: 'Cover' }],
      attachments: [{ fileName: 'secret.txt', content: 'CONFIDENTIAL-MARKER-9317' }],
    });

    const result = await engine.apply(bytes, [{ kind: 'removeAttachments', ids: ['secret.txt'] }]);
    const text = Buffer.from(result.bytes).toString('latin1');

    expect(text).not.toContain('CONFIDENTIAL-MARKER-9317');
  });

  it('replaces an attachment of the same name rather than listing it twice', async () => {
    const first = stagedFile('notes.txt', 'first version');
    const withFirst = await engine.apply(
      buildPdf({ pages: [{ text: 'Cover' }] }),
      [{ kind: 'addAttachments', tokens: [first.token] }],
      first.assets,
    );

    const second = stagedFile('notes.txt', 'second version');
    const withSecond = await engine.apply(
      withFirst.bytes,
      [{ kind: 'addAttachments', tokens: [second.token] }],
      second.assets,
    );

    const attachments = await engine.readAttachments(withSecond.bytes);
    expect(attachments).toHaveLength(1);

    const extracted = await engine.extractAttachment(withSecond.bytes, attachments[0]?.id ?? '');
    expect(new TextDecoder().decode(extracted?.bytes)).toBe('second version');
  });

  it('refuses a token that was never staged rather than writing nothing quietly', async () => {
    await expect(
      engine.apply(buildPdf({ pages: [{ text: 'Cover' }] }), [
        { kind: 'addAttachments', tokens: ['not-staged'] },
      ]),
    ).rejects.toMatchObject({ message: expect.stringContaining('no longer staged') as unknown });
  });

  it('returns null for an attachment that is no longer there', async () => {
    const bytes = buildPdf({ pages: [{ text: 'Cover' }] });
    expect(await engine.extractAttachment(bytes, 'gone.txt')).toBeNull();
  });
});

describe('risky names', () => {
  it('knows the extensions Windows will execute', () => {
    for (const name of ['setup.exe', 'run.BAT', 'script.ps1', 'macro.vbs', 'thing.lnk']) {
      expect(isRiskyAttachmentName(name)).toBe(true);
    }
  });

  it('leaves ordinary documents alone', () => {
    for (const name of ['notes.txt', 'report.pdf', 'sheet.xlsx', 'photo.png', 'README']) {
      expect(isRiskyAttachmentName(name)).toBe(false);
    }
  });
});
