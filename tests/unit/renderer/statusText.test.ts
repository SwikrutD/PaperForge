import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VIEW_STATE,
  initialEditState,
  type DocumentTab,
} from '../../../src/renderer/stores/documentStore';
import {
  describeDocument,
  describeView,
  formatFileSize,
} from '../../../src/renderer/components/shell/statusText';

/**
 * What the status bar says: facts about the document in front of the reader
 * and where they are in it — not the theme, and not "Ready".
 */

function tab(
  overrides: Partial<DocumentTab> = {},
  file: Partial<DocumentTab['session']['file']> = {},
): DocumentTab {
  return {
    session: {
      id: 's1',
      documentId: 'd1',
      openedAt: new Date().toISOString(),
      dirty: false,
      file: {
        path: 'C:/Docs/Report.pdf',
        displayName: 'Report.pdf',
        sizeBytes: 2_516_582,
        modifiedAt: new Date().toISOString(),
        readOnly: false,
        pdfVersion: '1.7',
        encryptionDetected: false,
        ...file,
      },
    },
    externalChange: null,
    view: DEFAULT_VIEW_STATE,
    edit: initialEditState('s1'),
    pageCount: 12,
    ...overrides,
  };
}

describe('the document side of the status bar', () => {
  it('names the file and its size', () => {
    expect(describeDocument(tab(), 1)).toEqual(['Report.pdf', '2.4 MB']);
  });

  it('says when there are unsaved changes', () => {
    const changed = tab({ edit: { ...initialEditState('s1'), dirty: true } });
    expect(describeDocument(changed, 1)).toContain('Unsaved changes');
  });

  it('says when the file is read-only, or changed or deleted on disk', () => {
    expect(describeDocument(tab({}, { readOnly: true }), 1)).toContain('Read-only');
    expect(describeDocument(tab({ externalChange: 'modified' }), 1)).toContain('Changed on disk');
    expect(describeDocument(tab({ externalChange: 'deleted' }), 1)).toContain('Deleted from disk');
  });

  it('counts the other documents open', () => {
    expect(describeDocument(tab(), 3)).toContain('3 documents open');
  });

  it('says how to open one when none is open', () => {
    expect(describeDocument(null, 0)).toEqual(['No document open', 'Ctrl+O opens a PDF']);
  });
});

describe('the view side of the status bar', () => {
  it('gives the page out of how many, and the zoom', () => {
    expect(describeView({ ...DEFAULT_VIEW_STATE, pageNumber: 3 }, 12)).toBe(
      'Page 3 of 12 · Fit width',
    );
  });

  it('gives a custom zoom as a percentage', () => {
    const view = { ...DEFAULT_VIEW_STATE, zoomMode: 'custom' as const, scale: 1.25 };
    expect(describeView(view, 12)).toBe('Page 1 of 12 · 125%');
  });

  it('leaves out the page count until the pages have been read', () => {
    expect(describeView(DEFAULT_VIEW_STATE, 0)).toBe('Page 1 · Fit width');
  });
});

describe('file sizes', () => {
  it('reads the way Explorer writes them', () => {
    expect(formatFileSize(512)).toBe('512 bytes');
    expect(formatFileSize(2048)).toBe('2 KB');
    expect(formatFileSize(2_516_582)).toBe('2.4 MB');
    expect(formatFileSize(3_221_225_472)).toBe('3 GB');
  });
});
