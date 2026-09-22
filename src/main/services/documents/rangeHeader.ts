export interface ByteRange {
  /** Inclusive first byte. */
  start: number;
  /** Inclusive last byte. */
  end: number;
}

export type RangeResult =
  { kind: 'full' } | { kind: 'partial'; range: ByteRange } | { kind: 'unsatisfiable' };

const SINGLE_RANGE = /^bytes=(\d*)-(\d*)$/;

/**
 * Parses a single-range HTTP Range header, which is all PDF.js ever sends.
 *
 * Anything else — several ranges, a unit that is not bytes, nonsense — is
 * answered with the whole file rather than an error, which is what RFC 9110
 * allows and keeps a viewer working.
 */
export function parseRangeHeader(header: string | null | undefined, size: number): RangeResult {
  if (header === null || header === undefined || header.trim() === '') return { kind: 'full' };

  const match = SINGLE_RANGE.exec(header.trim());
  if (match === null) return { kind: 'full' };

  const [, rawStart = '', rawEnd = ''] = match;
  if (rawStart === '' && rawEnd === '') return { kind: 'full' };
  if (size === 0) return { kind: 'unsatisfiable' };

  // "bytes=-500" asks for the last 500 bytes.
  if (rawStart === '') {
    const length = Number(rawEnd);
    if (length <= 0) return { kind: 'unsatisfiable' };
    return { kind: 'partial', range: { start: Math.max(0, size - length), end: size - 1 } };
  }

  const start = Number(rawStart);
  if (start >= size) return { kind: 'unsatisfiable' };

  const end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (end < start) return { kind: 'unsatisfiable' };

  return { kind: 'partial', range: { start, end } };
}

export function contentRangeHeader(range: ByteRange, size: number): string {
  return `bytes ${range.start}-${range.end}/${size}`;
}
