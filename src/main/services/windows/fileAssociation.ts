import { APP_NAME } from '@shared/constants/app';
import type { FileAssociationStatus } from '@shared/schemas/system';
import {
  deleteKey,
  deleteValue,
  readValue,
  runReg,
  writeKeys,
  type RegRunner,
  type RegistryKey,
} from './registry';

/**
 * Offering PaperForge for PDF files, the way Windows asks a per-user app to.
 *
 * Everything is written under HKEY_CURRENT_USER: a ProgID that opens a file
 * with PaperForge, an entry in the `.pdf` Open With list, and the
 * capabilities that make PaperForge a choice in Settings → Default apps.
 * Windows does not let an app make itself the default — that is the reader's
 * choice in Settings, which PaperForge can open but not make for them.
 */

export const PROG_ID = 'PaperForge.Document';
const CLASSES = 'HKCU\\Software\\Classes';
const CAPABILITIES = `HKCU\\Software\\${APP_NAME}\\Capabilities`;
const REGISTERED_APPLICATIONS = 'HKCU\\Software\\RegisteredApplications';
const USER_CHOICE =
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.pdf\\UserChoice';

/** The command Explorer runs to open a file with PaperForge. */
export function openCommand(executable: string): string {
  return `"${executable}" "%1"`;
}

/** Every key and value an association consists of. */
export function associationKeys(executable: string): RegistryKey[] {
  const exeName = executable.split(/[\\/]/).pop() ?? `${APP_NAME}.exe`;
  return [
    {
      key: `${CLASSES}\\${PROG_ID}`,
      values: [
        { name: null, type: 'REG_SZ', data: 'PDF Document' },
        { name: 'FriendlyTypeName', type: 'REG_SZ', data: 'PDF Document' },
      ],
    },
    {
      key: `${CLASSES}\\${PROG_ID}\\DefaultIcon`,
      values: [{ name: null, type: 'REG_SZ', data: `"${executable}",0` }],
    },
    {
      key: `${CLASSES}\\${PROG_ID}\\shell\\open\\command`,
      values: [{ name: null, type: 'REG_SZ', data: openCommand(executable) }],
    },
    {
      key: `${CLASSES}\\.pdf\\OpenWithProgids`,
      values: [{ name: PROG_ID, type: 'REG_NONE', data: '' }],
    },
    {
      key: `${CLASSES}\\Applications\\${exeName}`,
      values: [{ name: 'FriendlyAppName', type: 'REG_SZ', data: APP_NAME }],
    },
    {
      key: `${CLASSES}\\Applications\\${exeName}\\SupportedTypes`,
      values: [{ name: '.pdf', type: 'REG_SZ', data: '' }],
    },
    {
      key: `${CLASSES}\\Applications\\${exeName}\\shell\\open\\command`,
      values: [{ name: null, type: 'REG_SZ', data: openCommand(executable) }],
    },
    {
      key: CAPABILITIES,
      values: [
        { name: 'ApplicationName', type: 'REG_SZ', data: APP_NAME },
        {
          name: 'ApplicationDescription',
          type: 'REG_SZ',
          data: 'View, edit, organise and protect PDF documents, entirely offline.',
        },
      ],
    },
    {
      key: `${CAPABILITIES}\\FileAssociations`,
      values: [{ name: '.pdf', type: 'REG_SZ', data: PROG_ID }],
    },
    {
      key: REGISTERED_APPLICATIONS,
      values: [{ name: APP_NAME, type: 'REG_SZ', data: `Software\\${APP_NAME}\\Capabilities` }],
    },
  ];
}

export async function registerFileAssociation(
  executable: string,
  run: RegRunner = runReg,
): Promise<boolean> {
  return writeKeys(associationKeys(executable), run);
}

/** Takes away everything `registerFileAssociation` wrote, and nothing else. */
export async function unregisterFileAssociation(
  executable: string,
  run: RegRunner = runReg,
): Promise<void> {
  const exeName = executable.split(/[\\/]/).pop() ?? `${APP_NAME}.exe`;
  await deleteValue(`${CLASSES}\\.pdf\\OpenWithProgids`, PROG_ID, run);
  await deleteKey(`${CLASSES}\\${PROG_ID}`, run);
  await deleteKey(`${CLASSES}\\Applications\\${exeName}`, run);
  await deleteValue(REGISTERED_APPLICATIONS, APP_NAME, run);
  await deleteKey(`HKCU\\Software\\${APP_NAME}`, run);
}

/** Whether PaperForge is offered for PDFs, and whether it is the default. */
export async function readAssociation(
  executable: string,
  run: RegRunner = runReg,
): Promise<Pick<FileAssociationStatus, 'openWith' | 'isDefault'>> {
  const [command, listed, choice] = await Promise.all([
    readValue(`${CLASSES}\\${PROG_ID}\\shell\\open\\command`, null, run),
    readValue(`${CLASSES}\\.pdf\\OpenWithProgids`, PROG_ID, run),
    readValue(USER_CHOICE, 'ProgId', run),
  ]);
  const openWith =
    command !== null &&
    listed !== null &&
    command.toLowerCase() === openCommand(executable).toLowerCase();
  return { openWith, isDefault: openWith && choice === PROG_ID };
}
