import { describe, expect, it } from 'vitest';
import { safeFileName } from '../../../src/main/services/documents/pageExport';

/**
 * The renderer suggests a name for each file a split writes; the folder comes
 * from the reader. Only a file name may survive that journey.
 */
describe('safeFileName', () => {
  it('keeps an ordinary name', () => {
    expect(safeFileName('Report 1-4.pdf')).toBe('Report 1-4.pdf');
  });

  it('adds the extension when the suggestion has none', () => {
    expect(safeFileName('Chapter one')).toBe('Chapter one.pdf');
    expect(safeFileName('Chapter one.PDF')).toBe('Chapter one.pdf');
  });

  it('strips directories, so the file lands in the chosen folder', () => {
    expect(safeFileName('..\\..\\Windows\\System32\\evil.pdf')).toBe('evil.pdf');
    expect(safeFileName('../../etc/passwd')).toBe('passwd.pdf');
    expect(safeFileName('C:\\Users\\Someone\\notes.pdf')).toBe('notes.pdf');
  });

  it('replaces characters Windows will not accept', () => {
    expect(safeFileName('a:b*c?d"e<f>g|h.pdf')).toBe('a-b-c-d-e-f-g-h.pdf');
    expect(safeFileName(`line${String.fromCharCode(10)}break.pdf`)).toBe('line-break.pdf');
  });

  it('never produces a name that is only dots or spaces', () => {
    expect(safeFileName('   ')).toBe('pages.pdf');
    expect(safeFileName('..')).toBe('pages.pdf');
    expect(safeFileName('.pdf')).toBe('pages.pdf');
  });

  it('keeps the name short enough for a Windows path', () => {
    const name = safeFileName(`${'x'.repeat(400)}.pdf`);
    expect(name.length).toBeLessThanOrEqual(124);
    expect(name.endsWith('.pdf')).toBe(true);
  });
});
