import { app } from 'electron';
import { APP_NAME } from '@shared/constants/app';
import { appInfoSchema, type AppInfo } from '@shared/schemas/appInfo';

/** Collects local environment facts for the diagnostics surfaces. */
export function buildAppInfo(): AppInfo {
  return appInfoSchema.parse({
    name: APP_NAME,
    version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : app.getVersion(),
    isPackaged: app.isPackaged,
    platform: process.platform,
    arch: process.arch,
    locale: app.getLocale(),
    versions: {
      electron: process.versions.electron ?? 'unknown',
      chrome: process.versions.chrome ?? 'unknown',
      node: process.versions.node,
      v8: process.versions.v8,
    },
    paths: {
      userData: app.getPath('userData'),
      logs: app.getPath('logs'),
      temp: app.getPath('temp'),
    },
  } satisfies AppInfo);
}
