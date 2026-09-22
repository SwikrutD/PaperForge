/**
 * The page a typed value refers to: a page label if the document has one,
 * otherwise a plain page number. Returns null when it is neither.
 */
export function resolvePageEntry(
  text: string,
  pageLabels: readonly (string | null)[],
  pageCount: number,
): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;

  const labelled = pageLabels.findIndex(
    (label) => label !== null && label.toLowerCase() === trimmed.toLowerCase(),
  );
  if (labelled >= 0) return labelled + 1;

  const parsed = Number.parseInt(trimmed, 10);
  if (Number.isNaN(parsed)) return null;
  return Math.min(Math.max(1, parsed), Math.max(1, pageCount));
}
