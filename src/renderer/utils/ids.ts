let counter = 0;

/**
 * Short unique id for toasts and jobs. Uses the platform UUID when available
 * and falls back to a counter so tests and older environments still work.
 */
export function createId(prefix: string): string {
  counter += 1;
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${counter}-${random}`;
}
