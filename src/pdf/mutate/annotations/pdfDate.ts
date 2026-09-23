/**
 * PDF date strings: `D:YYYYMMDDHHmmSSOHH'mm`.
 *
 * Annotations carry creation and modification dates, and readers show them, so
 * PaperForge writes them properly rather than leaving them out.
 */

function pad(value: number, length = 2): string {
  return String(Math.abs(Math.trunc(value))).padStart(length, '0');
}

/** Formats a date the way a PDF wants it, with the local UTC offset. */
export function toPdfDate(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes === 0 ? 'Z' : offsetMinutes > 0 ? '+' : '-';
  const offset =
    offsetMinutes === 0
      ? "Z00'00"
      : `${sign}${pad(offsetMinutes / 60)}'${pad(Math.abs(offsetMinutes) % 60)}`;

  return (
    `D:${pad(date.getFullYear(), 4)}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}${offset}`
  );
}

const PDF_DATE =
  /^D?:?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(?:(Z|\+|-)(\d{2})'?(\d{2})?'?)?/;

/**
 * Reads a PDF date into an ISO string, or null when it is not one.
 *
 * Producers are careless with this field — missing components, missing
 * apostrophes, a trailing quote — so anything unreadable is reported as
 * unknown rather than guessed at.
 */
export function fromPdfDate(value: string | undefined | null): string | null {
  if (typeof value !== 'string') return null;
  const match = PDF_DATE.exec(value.trim());
  if (match === null) return null;

  const [, year, month = '01', day = '01', hour = '00', minute = '00', second = '00'] = match;
  const sign = match[7];
  const offsetHours = match[8];
  const offsetMinutes = match[9] ?? '00';

  const offset =
    sign === undefined || sign === 'Z' || offsetHours === undefined
      ? 'Z'
      : `${sign}${offsetHours}:${offsetMinutes}`;

  const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}${offset}`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
