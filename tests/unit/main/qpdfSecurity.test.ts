import { describe, expect, it } from 'vitest';
import {
  atLeast,
  encryptArguments,
  permissionArguments,
  scrub,
} from '../../../src/main/services/qpdf/qpdfSecurity';
import {
  DEFAULT_PERMISSION_CHOICES,
  type ProtectRequest,
} from '../../../src/shared/schemas/protect';

const REQUEST: ProtectRequest = {
  sessionId: 'session-1',
  openPassword: 'open me',
  permissionsPassword: 'change me',
  keyLengthBits: 256,
  permissions: DEFAULT_PERMISSION_CHOICES,
  encryptMetadata: true,
};

/**
 * The argument spelling changed at qpdf 11, and a wrong one would only show up
 * as a refusal at the moment somebody tried to protect a document. Building
 * the arguments is pure, so both forms are checked here rather than trusted.
 */
describe('qpdf encryption arguments', () => {
  it('uses the named options qpdf 11 introduced', () => {
    const args = encryptArguments(REQUEST, true);

    expect(args[0]).toBe('--encrypt');
    expect(args).toContain('--user-password=open me');
    expect(args).toContain('--owner-password=change me');
    expect(args).toContain('--bits=256');
    expect(args[args.length - 1]).toBe('--');
  });

  it('falls back to the positional form for an older qpdf', () => {
    const args = encryptArguments(REQUEST, false);

    expect(args.slice(0, 4)).toEqual(['--encrypt', 'open me', 'change me', '256']);
    expect(args[args.length - 1]).toBe('--');
  });

  it('passes a password with spaces and quotes as one argument, unescaped', () => {
    const awkward: ProtectRequest = {
      ...REQUEST,
      openPassword: 'a "quoted" one & another',
      permissionsPassword: "it's fine",
    };
    const args = encryptArguments(awkward, true);

    // No shell is involved, so nothing needs escaping and nothing is escaped.
    expect(args).toContain('--user-password=a "quoted" one & another');
    expect(args).toContain("--owner-password=it's fine");
  });

  it('ends with the separator, so a file named like an option is still a file', () => {
    expect(encryptArguments(REQUEST, true).filter((arg) => arg === '--')).toHaveLength(1);
  });
});

describe('qpdf permission arguments', () => {
  const options = { encryptMetadata: true, ownerPasswordEmpty: false };

  it('writes the permission ladder at 128 and 256 bits', () => {
    const args = permissionArguments(
      128,
      { print: 'low', modify: 'annotate', extract: false, extractForAccessibility: true },
      options,
    );

    expect(args).toEqual(['--print=low', '--modify=annotate', '--extract=n', '--accessibility=y']);
  });

  it('folds the finer choices into the four bits 40-bit RC4 actually has', () => {
    const args = permissionArguments(
      40,
      { print: 'low', modify: 'annotate', extract: true, extractForAccessibility: false },
      options,
    );

    // 40-bit has no low-resolution printing and no separate accessibility bit,
    // so passing them would only make qpdf refuse the whole run.
    expect(args).toEqual(['--print=y', '--modify=n', '--extract=y', '--annotate=y']);
    expect(args.join(' ')).not.toContain('accessibility');
  });

  it('only asks for cleartext metadata when that was the choice', () => {
    expect(permissionArguments(256, DEFAULT_PERMISSION_CHOICES, options)).not.toContain(
      '--cleartext-metadata',
    );
    expect(
      permissionArguments(256, DEFAULT_PERMISSION_CHOICES, {
        ...options,
        encryptMetadata: false,
      }),
    ).toContain('--cleartext-metadata');
  });

  /**
   * At 256 bits qpdf refuses an empty owner password unless it is told to
   * allow it, because the restrictions can then be lifted by anyone.
   */
  it('allows the insecure case at 256 bits only when there is no owner password', () => {
    expect(
      permissionArguments(256, DEFAULT_PERMISSION_CHOICES, {
        ...options,
        ownerPasswordEmpty: true,
      }),
    ).toContain('--allow-insecure');
    expect(permissionArguments(256, DEFAULT_PERMISSION_CHOICES, options)).not.toContain(
      '--allow-insecure',
    );
    expect(
      permissionArguments(128, DEFAULT_PERMISSION_CHOICES, {
        ...options,
        ownerPasswordEmpty: true,
      }),
    ).not.toContain('--allow-insecure');
  });
});

describe('scrubbing qpdf output', () => {
  it('takes every password out of anything qpdf says', () => {
    const output = scrub('qpdf: invalid password "hunter2" for file', ['hunter2', '']);

    expect(output).not.toContain('hunter2');
    expect(output).toContain('***');
  });

  it('leaves text alone when there is nothing to take out', () => {
    expect(scrub('qpdf: operation succeeded', [''])).toBe('qpdf: operation succeeded');
  });
});

describe('version comparison', () => {
  it('compares major and minor, and treats an unknown version as too old', () => {
    expect(atLeast([11, 9], [11, 0])).toBe(true);
    expect(atLeast([11, 0], [11, 0])).toBe(true);
    expect(atLeast([10, 6], [11, 0])).toBe(false);
    expect(atLeast([10, 2], [10, 2])).toBe(true);
    expect(atLeast([10, 1], [10, 2])).toBe(false);
    expect(atLeast([12, 0], [11, 0])).toBe(true);
    expect(atLeast(null, [10, 2])).toBe(false);
  });
});
