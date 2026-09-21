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

/** Name of the settings file inside the per-user data directory. */
export const SETTINGS_FILE_NAME = 'settings.json';

/** Bumped whenever persisted settings need a migration. */
export const SETTINGS_VERSION = 1;
