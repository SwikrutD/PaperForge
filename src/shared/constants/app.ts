/** Human-facing product name. Used in window titles and about surfaces. */
export const APP_NAME = 'PaperForge';

/** Stable identifier used for on-disk folders and single-instance locks. */
export const APP_ID = 'paperforge';

/** Custom scheme used to serve the packaged renderer with a strict CSP. */
export const RENDERER_SCHEME = 'app';

/** Host component of the renderer origin: app://renderer/index.html */
export const RENDERER_HOST = 'renderer';

/** Origin of the packaged renderer. */
export const RENDERER_ORIGIN = `${RENDERER_SCHEME}://${RENDERER_HOST}`;

/** Scheme that serves the bytes of an open document to the renderer. */
export const DOCUMENT_SCHEME = 'pfdoc';

/** Host component of a document URL: pfdoc://document/<session id> */
export const DOCUMENT_HOST = 'document';

/**
 * URL the renderer loads an open document from.
 *
 * The revision is part of the URL so that a change produces a different one:
 * the viewer reloads because it is asked for a document it has not seen,
 * rather than because a cache was invalidated.
 */
export function documentUrlForSession(sessionId: string, revision = 0): string {
  const base = `${DOCUMENT_SCHEME}://${DOCUMENT_HOST}/${encodeURIComponent(sessionId)}`;
  return revision === 0 ? base : `${base}?r=${String(revision)}`;
}

/** Host component of a staged source URL: pfdoc://source/<source id> */
export const SOURCE_HOST = 'source';

/**
 * URL the renderer previews a staged source from.
 *
 * A source is a file the reader added to a new document but has not saved
 * anywhere: the bytes live in the main process, and this is how the renderer
 * draws a thumbnail of one without ever holding it.
 */
export function sourceUrlFor(sourceId: string): string {
  return `${DOCUMENT_SCHEME}://${SOURCE_HOST}/${encodeURIComponent(sourceId)}`;
}

/** Name of the settings file inside the per-user data directory. */
export const SETTINGS_FILE_NAME = 'settings.json';

/** Bumped whenever persisted settings need a migration. */
export const SETTINGS_VERSION = 1;
