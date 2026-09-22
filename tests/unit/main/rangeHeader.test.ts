import { describe, expect, it } from 'vitest';
import {
  contentRangeHeader,
  parseRangeHeader,
} from '../../../src/main/services/documents/rangeHeader';

describe('parseRangeHeader', () => {
  it('serves the whole file when no range is asked for', () => {
    expect(parseRangeHeader(null, 100)).toEqual({ kind: 'full' });
    expect(parseRangeHeader('', 100)).toEqual({ kind: 'full' });
    expect(parseRangeHeader(undefined, 100)).toEqual({ kind: 'full' });
  });

  it('reads an explicit range', () => {
    expect(parseRangeHeader('bytes=0-99', 1000)).toEqual({
      kind: 'partial',
      range: { start: 0, end: 99 },
    });
    expect(parseRangeHeader('bytes=500-599', 1000)).toEqual({
      kind: 'partial',
      range: { start: 500, end: 599 },
    });
  });

  it('reads an open-ended range', () => {
    expect(parseRangeHeader('bytes=900-', 1000)).toEqual({
      kind: 'partial',
      range: { start: 900, end: 999 },
    });
  });

  it('reads a suffix range, which is how a PDF trailer is fetched', () => {
    expect(parseRangeHeader('bytes=-512', 1000)).toEqual({
      kind: 'partial',
      range: { start: 488, end: 999 },
    });
    expect(parseRangeHeader('bytes=-5000', 1000)).toEqual({
      kind: 'partial',
      range: { start: 0, end: 999 },
    });
  });

  it('clamps an end past the last byte', () => {
    expect(parseRangeHeader('bytes=990-99999', 1000)).toEqual({
      kind: 'partial',
      range: { start: 990, end: 999 },
    });
  });

  it('rejects a range that starts past the end', () => {
    expect(parseRangeHeader('bytes=1000-1100', 1000)).toEqual({ kind: 'unsatisfiable' });
    expect(parseRangeHeader('bytes=5-1', 1000)).toEqual({ kind: 'unsatisfiable' });
    expect(parseRangeHeader('bytes=0-10', 0)).toEqual({ kind: 'unsatisfiable' });
  });

  it('falls back to the whole file for anything it does not understand', () => {
    expect(parseRangeHeader('items=0-10', 1000)).toEqual({ kind: 'full' });
    expect(parseRangeHeader('bytes=0-10, 20-30', 1000)).toEqual({ kind: 'full' });
    expect(parseRangeHeader('nonsense', 1000)).toEqual({ kind: 'full' });
  });

  it('formats the Content-Range header', () => {
    expect(contentRangeHeader({ start: 0, end: 99 }, 1000)).toBe('bytes 0-99/1000');
  });
});
