import { app } from 'electron';
import os from 'node:os';
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
    userName: currentUserName(),
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

/**
 * Who is signed in, which is what a new comment is signed with until the
 * reader sets a name of their own. Reading it can fail on a locked-down
 * account, and that is not worth failing startup over.
 */
function currentUserName(): string {
  try {
    const name = os.userInfo().username.trim();
    return name === '' ? 'Unknown' : name;
  } catch {
    return 'Unknown';
  }
}
