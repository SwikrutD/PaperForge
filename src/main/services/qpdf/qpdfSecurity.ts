import { AppError } from '@shared/errors/appError';
import type { KeyLength, PermissionChoices, ProtectRequest } from '@shared/schemas/protect';
import { QpdfExitError, type QpdfService } from './qpdfService';

/**
 * Document security through qpdf.
 *
 * Encrypting and decrypting a PDF means rewriting every string and stream in
 * it. qpdf is the engine for that (CLAUDE.md section 2.3): it is launched only
 * from here, its arguments are built as an array and never shell-joined, and a
 * password is handed over on standard input wherever the installed version
 * supports it, so it does not appear in a command line other programs can see.
 *
 * Nothing here logs a password, and every error is scrubbed before it is
 * allowed to travel.
 */

/** `--password-file` arrived in qpdf 10.2; before that, only `--password`. */
const PASSWORD_FILE_SINCE: readonly [number, number] = [10, 2];
/** qpdf 11 introduced the named `--encrypt` options used here. */
const NAMED_ENCRYPT_SINCE: readonly [number, number] = [11, 0];

export interface QpdfSecurityDeps {
  qpdf: QpdfService;
}

export class QpdfSecurity {
  constructor(private readonly deps: QpdfSecurityDeps) {}

  /** True when qpdf is installed, which the security tools need. */
  async available(): Promise<boolean> {
    return (await this.deps.qpdf.resolve()) !== null;
  }

  /** Writes an encrypted copy of `input` at `output`. */
  async encrypt(input: string, output: string, request: ProtectRequest): Promise<void> {
    const version = await this.deps.qpdf.version();
    const args = [
      ...encryptArguments(request, atLeast(version, NAMED_ENCRYPT_SINCE)),
      input,
      output,
    ];

    await this.runScrubbed(args, [request.openPassword, request.permissionsPassword]);
  }

  /**
   * Writes a copy of `input` at `output` with its security removed.
   *
   * qpdf will only do this with a password that actually opens the document,
   * which is the same rule every conforming tool follows.
   */
  async decrypt(input: string, output: string, password: string): Promise<void> {
    const version = await this.deps.qpdf.version();
    const useStdin = atLeast(version, PASSWORD_FILE_SINCE);

    const args = [
      ...(password === '' ? [] : useStdin ? ['--password-file=-'] : [`--password=${password}`]),
      '--decrypt',
      input,
      output,
    ];

    await this.runScrubbed(
      args,
      [password],
      password !== '' && useStdin ? `${password}\n` : undefined,
    );
  }

  /**
   * Runs qpdf and makes sure nothing it says carries a password back out.
   *
   * qpdf echoes the failing argument in some messages, so every password is
   * struck from the output before the error is built — the scrubbing happens
   * here rather than at the log, so a password cannot reach a toast either.
   */
  private async runScrubbed(
    args: readonly string[],
    secrets: readonly string[],
    stdin?: string,
  ): Promise<void> {
    try {
      await this.deps.qpdf.run(args, stdin === undefined ? {} : { stdin });
    } catch (error) {
      if (!(error instanceof QpdfExitError)) throw error;

      const output = scrub(`${error.stdout}\n${error.stderr}`.trim(), secrets);
      // Exit 2 is qpdf's "I could not do it"; a wrong password is the reason
      // often enough to say so plainly.
      if (/password/i.test(output) && !/warning/i.test(output)) {
        throw new AppError('pdf/wrong-password', {
          message: 'That password did not open the document.',
          details: output.slice(0, 1000),
        });
      }

      throw new AppError('io/write-failed', {
        message: 'qpdf could not write that document.',
        details: output.slice(0, 2000),
      });
    }
  }
}

/** Replaces every secret with a marker, however it appears in the text. */
export function scrub(text: string, secrets: readonly string[]): string {
  let scrubbed = text;
  for (const secret of secrets) {
    if (secret === '') continue;
    scrubbed = scrubbed.split(secret).join('***');
  }
  return scrubbed;
}

/**
 * The arguments for `--encrypt`, built for the installed qpdf.
 *
 * Pure, and exported so the spelling can be tested without a qpdf to run: the
 * two forms differ enough that getting one wrong would only show up as a
 * refusal at the moment a reader tried to protect something.
 */
export function encryptArguments(request: ProtectRequest, named: boolean): string[] {
  const { openPassword, permissionsPassword, keyLengthBits, permissions } = request;

  const head = named
    ? [
        '--encrypt',
        `--user-password=${openPassword}`,
        `--owner-password=${permissionsPassword}`,
        `--bits=${String(keyLengthBits)}`,
      ]
    : ['--encrypt', openPassword, permissionsPassword, String(keyLengthBits)];

  return [
    ...head,
    ...permissionArguments(keyLengthBits, permissions, {
      encryptMetadata: request.encryptMetadata,
      ownerPasswordEmpty: permissionsPassword === '',
    }),
    '--',
  ];
}

/**
 * The permission flags qpdf accepts at a given key length.
 *
 * 40-bit RC4 has only the four coarse bits, so the finer choices are folded
 * into them rather than passed to a qpdf that would refuse them.
 */
export function permissionArguments(
  keyLengthBits: KeyLength,
  permissions: PermissionChoices,
  options: { encryptMetadata: boolean; ownerPasswordEmpty: boolean },
): string[] {
  if (keyLengthBits === 40) {
    return [
      `--print=${yesNo(permissions.print !== 'none')}`,
      `--modify=${yesNo(permissions.modify === 'all')}`,
      `--extract=${yesNo(permissions.extract)}`,
      `--annotate=${yesNo(permissions.modify === 'all' || permissions.modify === 'annotate')}`,
    ];
  }

  const args = [
    `--print=${permissions.print}`,
    `--modify=${permissions.modify}`,
    `--extract=${yesNo(permissions.extract)}`,
    `--accessibility=${yesNo(permissions.extractForAccessibility)}`,
  ];

  // Leaving metadata readable is a deliberate choice, so it is only passed
  // when it was made.
  if (!options.encryptMetadata) args.push('--cleartext-metadata');

  // Without an owner password the restrictions can be lifted by anyone, and
  // qpdf refuses to write that at 256 bits unless it is told to allow it.
  if (keyLengthBits === 256 && options.ownerPasswordEmpty) args.push('--allow-insecure');

  return args;
}

function yesNo(value: boolean): string {
  return value ? 'y' : 'n';
}

/** True when the installed version is at least the one given. */
export function atLeast(
  version: readonly [number, number] | null,
  minimum: readonly [number, number],
): boolean {
  if (version === null) return false;
  if (version[0] !== minimum[0]) return version[0] > minimum[0];
  return version[1] >= minimum[1];
}
