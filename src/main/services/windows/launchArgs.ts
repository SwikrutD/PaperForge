import path from 'node:path';

/** What PaperForge was started, or started again, to do. */
export interface LaunchRequest {
  /** PDF files to open, as absolute paths. */
  paths: string[];
  /** A jump-list task asking for another window. */
  newWindow: boolean;
}

/** The jump-list task that opens another window. */
export const NEW_WINDOW_ARG = '--new-window';

/** More than this many files at once is not a reader opening documents. */
const MAX_PATHS = 50;

/**
 * Reads the files Explorer, Open With or a jump list handed PaperForge.
 *
 * Anything that is not plainly a path to a PDF is ignored: switches Chromium
 * or Squirrel add, URLs of any scheme, device paths and the app's own entry
 * point. A relative path is read against the directory the launch came from,
 * which for a second instance is that instance's, not this one's. Whether the
 * file exists and really is a PDF is checked by the normal open flow.
 */
export function parseLaunchArgs(
  argv: readonly string[],
  options: { cwd: string; skip: number },
): LaunchRequest {
  // Chromium may move switches ahead of the program's own arguments when it
  // passes them to the running copy, so the switch is looked for everywhere.
  const request: LaunchRequest = { paths: [], newWindow: argv.includes(NEW_WINDOW_ARG) };
  const seen = new Set<string>();

  for (const raw of argv.slice(options.skip)) {
    const arg = raw.trim();
    if (arg === '' || arg.startsWith('-')) continue;
    // A URL of any kind, `file:` included, is not something to open from here.
    if (/^[a-z][a-z0-9+.-]+:\/\//i.test(arg)) continue;
    if (isDevicePath(arg)) continue;
    if (path.extname(arg).toLowerCase() !== '.pdf') continue;

    const resolved = path.resolve(options.cwd, arg);
    const key = resolved.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    request.paths.push(resolved);
    if (request.paths.length >= MAX_PATHS) break;
  }

  return request;
}

/**
 * Device and pipe namespaces are never documents. `\\?\C:\` and `\\?\UNC\`
 * are only long-path spellings of ordinary files, so they pass.
 */
function isDevicePath(arg: string): boolean {
  if (arg.startsWith('\\\\.\\')) return true;
  if (arg.startsWith('\\\\?\\')) return !/^\\\\\?\\([a-z]:\\|UNC\\)/i.test(arg);
  return false;
}

/**
 * How many leading arguments are the program itself: the executable, and in
 * development the script Electron was asked to run.
 */
export function launchArgsToSkip(argv: readonly string[], packaged: boolean): number {
  if (packaged) return 1;
  // `electron.exe [switches] path/to/main.js [args]`: everything up to the
  // entry script belongs to Electron.
  const script = argv.findIndex(
    (arg, index) => index > 0 && !arg.startsWith('-') && /\.(c|m)?js$/i.test(arg),
  );
  return script < 0 ? 1 : script + 1;
}
