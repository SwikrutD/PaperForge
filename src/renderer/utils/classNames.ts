/**
 * Joins CSS Module class names, dropping anything absent. CSS Module lookups
 * are typed as possibly undefined, so components compose classes through this
 * helper rather than string templates.
 */
export function cx(...values: Array<string | false | null | undefined>): string {
  return values
    .filter((value): value is string => typeof value === 'string' && value !== '')
    .join(' ');
}
