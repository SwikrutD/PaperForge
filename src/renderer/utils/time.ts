const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 60 * 60 * 1000],
  ['month', 30 * 24 * 60 * 60 * 1000],
  ['week', 7 * 24 * 60 * 60 * 1000],
  ['day', 24 * 60 * 60 * 1000],
  ['hour', 60 * 60 * 1000],
  ['minute', 60 * 1000],
];

/**
 * "3 days ago" style text for recent-file timestamps. Falls back to the raw
 * value when the timestamp cannot be parsed, rather than showing "Invalid Date".
 */
export function formatRelativeTime(isoTimestamp: string, now: Date = new Date()): string {
  const then = new Date(isoTimestamp);
  const time = then.getTime();
  if (Number.isNaN(time)) return isoTimestamp;

  const deltaMs = time - now.getTime();
  const absolute = Math.abs(deltaMs);
  if (absolute < 60 * 1000) return 'just now';

  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const [unit, size] of UNITS) {
    if (absolute >= size) return formatter.format(Math.round(deltaMs / size), unit);
  }
  return 'just now';
}
