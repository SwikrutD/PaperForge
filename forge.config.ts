import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

// Deny by default: only the Vite build output, the package manifest and the
// legal notices ship inside the asar. Everything else in the repository is
// development-time material.
const PACKAGED_PATHS: RegExp[] = [
  /^\/\.vite($|\/)/,
  /^\/package\.json$/,
  /^\/LICENSE$/,
  /^\/THIRD_PARTY_NOTICES\.md$/,
];

function shouldIgnoreInPackage(filePath: string): boolean {
  if (filePath === '') return false;
  return !PACKAGED_PATHS.some((pattern) => pattern.test(filePath));
}

const config: ForgeConfig = {
  packagerConfig: {
    name: 'PaperForge',
    executableName: 'PaperForge',
    icon: 'resources/icons/icon',
    asar: true,
    ignore: shouldIgnoreInPackage,
    win32metadata: {
      CompanyName: 'PaperForge',
      ProductName: 'PaperForge',
      FileDescription: 'PaperForge — offline PDF workspace',
      OriginalFilename: 'PaperForge.exe',
      'requested-execution-level': 'asInvoker',
    },
  },
  rebuildConfig: {},
  makers: [
    // A per-user installer: it puts PaperForge in %LOCALAPPDATA%, makes Start
    // menu and desktop shortcuts, offers it for PDF files and needs no
    // administrator rights. PaperForge's own installer events do the
    // shortcuts and the association (src/main/services/windows/squirrel.ts).
    new MakerSquirrel(
      {
        name: 'PaperForge',
        title: 'PaperForge',
        authors: 'PaperForge contributors',
        description: 'An offline PDF workspace for Windows.',
        exe: 'PaperForge.exe',
        setupExe: 'PaperForge-Setup.exe',
        setupIcon: 'resources/icons/icon.ico',
        // The installer would otherwise download the Electron icon from the
        // internet for Apps & features. A local file is never fetched over
        // the network; where it does not exist the copy fails quietly and
        // PaperForge points the entry at its own executable when it starts.
        iconUrl: pathToFileURL(path.resolve('resources/icons/icon.ico')).href,
        noMsi: true,
      },
      ['win32'],
    ),
    new MakerZIP({}, ['win32']),
  ],
  plugins: [
    new VitePlugin({
      build: [
        { entry: 'src/main/index.ts', config: 'vite.main.config.mts', target: 'main' },
        { entry: 'src/preload/index.ts', config: 'vite.preload.config.mts', target: 'preload' },
      ],
      renderer: [{ name: 'main_window', config: 'vite.renderer.config.mts' }],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
