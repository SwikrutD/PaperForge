import path from 'node:path';

function normalizeForCompare(value: string): string {
  const normalized = path.resolve(value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

/** True when `target` is the same path as `parent` or lives underneath it. */
export function isPathInside(parent: string, target: string): boolean {
  const parentPath = normalizeForCompare(parent);
  const targetPath = normalizeForCompare(target);
  if (parentPath === targetPath) return true;
  const relative = path.relative(parentPath, targetPath);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * Resolves a request path (for example from a custom protocol URL) against a
 * root directory, rejecting traversal, absolute paths and Windows drive
 * qualifiers. Returns null when the result would escape the root.
 */
export function resolveWithinRoot(root: string, requestPath: string): string | null {
  const trimmed = requestPath.replace(/^[\\/]+/, '');
  if (trimmed === '') return null;
  if (trimmed.includes('\0')) return null;
  if (path.isAbsolute(trimmed) || /^[a-zA-Z]:/.test(trimmed)) return null;

  const resolved = path.resolve(root, trimmed);
  return isPathInside(root, resolved) ? resolved : null;
}
