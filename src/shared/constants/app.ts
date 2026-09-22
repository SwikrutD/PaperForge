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

/** Name of the settings file inside the per-user data directory. */
export const SETTINGS_FILE_NAME = 'settings.json';

/** Bumped whenever persisted settings need a migration. */
export const SETTINGS_VERSION = 1;
