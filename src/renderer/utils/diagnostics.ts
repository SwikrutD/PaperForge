import type { AppInfo } from '@shared/schemas/appInfo';

/** Label/value pairs shown in the Environment panel and the About dialog. */
export function diagnosticsRows(info: AppInfo): Array<[string, string]> {
  return [
    ['Version', info.version],
    ['Build', info.isPackaged ? 'Packaged' : 'Development'],
    ['Electron', info.versions.electron],
    ['Chromium', info.versions.chrome],
    ['Node', info.versions.node],
    ['Platform', `${info.platform} ${info.arch}`],
    ['Locale', info.locale],
    ['Settings folder', info.paths.userData],
    ['Log folder', info.paths.logs],
  ];
}

/** The copyable block used for bug reports. Contains no document content. */
export function buildDiagnosticsText(info: AppInfo): string {
  return diagnosticsRows(info)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');
}
