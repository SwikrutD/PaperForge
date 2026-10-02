/**
 * The display order, flattened into rows with their depth. PDF.js gives each
 * id as a string and each nested list as `{ name, order }`: a named one is a
 * heading over its layers, an unnamed one holds the children of the layer
 * before it.
 */
export function orderRows(
  order: readonly unknown[],
  depth: number,
): Array<{ id: string; depth: number } | { heading: string; depth: number }> {
  const rows: Array<{ id: string; depth: number } | { heading: string; depth: number }> = [];
  for (const entry of order) {
    if (typeof entry === 'string') rows.push({ id: entry, depth });
    else if (Array.isArray(entry)) rows.push(...orderRows(entry, depth + 1));
    else if (entry !== null && typeof entry === 'object' && 'order' in entry) {
      const { name, order: nested } = entry as { name?: unknown; order: unknown[] };
      if (typeof name === 'string' && name !== '') {
        rows.push({ heading: name, depth });
        rows.push(...orderRows(nested, depth + 1));
      } else {
        rows.push(...orderRows(nested, depth + 1));
      }
    }
  }
  return rows;
}
