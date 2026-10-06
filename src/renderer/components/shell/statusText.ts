import type { DocumentTab, DocumentViewState } from '../../stores/documentStore';

/**
 * What the status bar says. It is for facts the reader can use at a glance —
 * which document this is, whether it has unsaved changes, whether it can be
 * saved in place, where they are in it — not for the theme or a "Ready" that
 * never changes.
 */

const ZOOM_LABEL = {
  fitPage: 'Fit page',
  fitWidth: 'Fit width',
  actual: 'Actual size',
} as const;

/** The active document, as short facts in order of importance. */
export function describeDocument(tab: DocumentTab | null, openCount: number): string[] {
  if (tab === null) return ['No document open', 'Ctrl+O opens a PDF'];

  const { file } = tab.session;
  const parts = [file.displayName, formatFileSize(file.sizeBytes)];
  if (tab.edit.dirty || tab.session.dirty) parts.push('Unsaved changes');
  if (file.readOnly) parts.push('Read-only');
  if (tab.externalChange === 'modified') parts.push('Changed on disk');
  if (tab.externalChange === 'deleted') parts.push('Deleted from disk');
  if (openCount > 1) parts.push(`${String(openCount)} documents open`);
  return parts;
}

/** "Page 2 of 12 · Fit width · 90°", or "Page 2 of 12 · 125%" when zoomed by hand. */
export function describeView(view: DocumentViewState, pageCount: number): string {
  const page =
    pageCount > 0
      ? `Page ${String(view.pageNumber)} of ${String(pageCount)}`
      : `Page ${String(view.pageNumber)}`;
  const zoom =
    view.zoomMode === 'custom'
      ? `${String(Math.round(view.scale * 100))}%`
      : ZOOM_LABEL[view.zoomMode];

  const parts = [page, zoom];
  if (view.pageMode === 'single') parts.push('Single page');
  if (view.spread === 'twoPage') parts.push(view.coverPage ? 'Two pages, cover' : 'Two pages');
  if (view.rotation !== 0) parts.push(`${String(view.rotation)}°`);
  return parts.join(' · ');
}

/** A size the way Windows Explorer writes it: 512 bytes, 2 KB, 2.4 MB, 3 GB. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} bytes`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${String(rounded)} ${units[unit] ?? 'KB'}`;
}
