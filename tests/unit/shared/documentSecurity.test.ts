import { describe, expect, it } from 'vitest';
import {
  permissionsFromBits,
  readEncryptionDictionary,
} from '../../../src/pdf/security/encryptionDictionary';
import { readSecuritySummary } from '../../../src/pdf/security/summary';
import type { DocumentPermissions } from '../../../src/shared/schemas/protect';
import { ALL_PERMISSIONS } from '../../../src/shared/schemas/protect';
import { buildPdf, threePageDocument } from '../../fixtures/pdf';

/**
 * Reading a document's security without a sidecar and without a password.
 *
 * The encryption dictionary is stored in the clear, which is what makes this
 * possible; nothing here decrypts anything.
 */
describe('encryption dictionary', () => {
  it('reports no security for an ordinary document', () => {
    const summary = readSecuritySummary(threePageDocument());

    expect(summary.encrypted).toBe(false);
    expect(summary.openPasswordRequired).toBe(false);
    expect(summary.permissions).toBeNull();
  });

  it('reads the handler, the algorithm and the permissions of an encrypted one', () => {
    const bytes = buildPdf({ pages: [{ text: 'Secret' }], password: 'letmein' });
    const summary = readSecuritySummary(bytes);

    expect(summary.encrypted).toBe(true);
    expect(summary.handler).toBe('Standard');
    expect(summary.revision).toBe(2);
    expect(summary.keyLengthBits).toBe(40);
    expect(summary.algorithm).toBe('RC4 40-bit');
    expect(summary.permissionBits).toBe(-1);
  });

  /**
   * The distinction the Protect dialog has to make: a document locked shut is
   * not the same as one that merely asks not to be printed.
   */
  it('knows that a document with a user password needs one to open', () => {
    const bytes = buildPdf({ pages: [{ text: 'Secret' }], password: 'letmein' });

    expect(readSecuritySummary(bytes).openPasswordRequired).toBe(true);
  });

  it('knows that a document with an empty user password does not', () => {
    // An owner-password-only document: the user password is empty, so any
    // reader opens it and the restrictions are all it carries.
    const bytes = buildPdf({ pages: [{ text: 'Restricted' }], password: '' });

    expect(readSecuritySummary(bytes).openPasswordRequired).toBe(false);
  });

  it('finds the dictionary of the most recent revision when a file was updated', () => {
    const first = buildPdf({ pages: [{ text: 'One' }] });
    // A second revision appended to the first, referring to a later /Encrypt.
    const appended = Buffer.concat([
      first,
      Buffer.from(
        '99 0 obj\n<< /Filter /Standard /V 4 /R 4 /Length 128 /P -3904 ' +
          '/CF << /StdCF << /CFM /AESV2 >> >> /StmF /StdCF /StrF /StdCF >>\nendobj\n' +
          'trailer\n<< /Encrypt 99 0 R >>\n%%EOF\n',
        'latin1',
      ),
    ]);

    const dictionary = readEncryptionDictionary(appended);
    expect(dictionary?.version).toBe(4);
    expect(dictionary?.keyLengthBits).toBe(128);
    expect(dictionary?.streamMethod).toBe('AESV2');
  });
});

describe('permission bits', () => {
  /** Every restriction off is what an unprotected document allows. */
  it('reads a fully permissive /P as everything allowed', () => {
    expect(permissionsFromBits(-1, 4)).toEqual(ALL_PERMISSIONS);
  });

  it('reads printing, copying and changing separately', () => {
    // Bit 3 (print) and bit 5 (extract) cleared; the rest set.
    const bits = -1 & ~(1 << 2) & ~(1 << 4);
    const permissions = permissionsFromBits(bits, 4);

    expect(permissions.print).toBe('none');
    expect(permissions.extract).toBe(false);
    expect(permissions.modify).toBe('all');
  });

  it('tells low-resolution printing from none and from full', () => {
    const lowOnly = -1 & ~(1 << 11);
    expect(permissionsFromBits(lowOnly, 4).print).toBe('low');
    expect(permissionsFromBits(-1, 4).print).toBe('full');
  });

  it('falls back to the coarse bits at revision 2, which has no others', () => {
    // Revision 2 has no separate bit for assistive reading, so it follows
    // copying rather than being reported as denied.
    const noExtract = -1 & ~(1 << 4);
    expect(permissionsFromBits(noExtract, 2).extractForAccessibility).toBe(false);
    expect(permissionsFromBits(-1, 2).extractForAccessibility).toBe(true);
  });

  /** Every restriction on: the value Acrobat writes for a locked-down file. */
  it('reads a fully restrictive /P as nothing allowed', () => {
    const nothing = -1 & ~0b1111_1111_0011_1100;
    const permissions: DocumentPermissions = permissionsFromBits(nothing, 4);

    expect(permissions).toEqual({
      print: 'none',
      modify: 'none',
      extract: false,
      extractForAccessibility: false,
      fillForms: false,
      annotate: false,
      assemble: false,
    });
  });

  /**
   * The ladder is what a writer actually controls, so the finer bits have to
   * agree with it rather than contradict it.
   */
  it('reads the changing ladder from the bits that set it', () => {
    const only = (...masks: number[]): number =>
      masks.reduce((bits, mask) => bits | mask, -1 & ~0b1111_1111_0011_1100);

    expect(permissionsFromBits(only(1 << 10), 4).modify).toBe('assembly');
    expect(permissionsFromBits(only(1 << 8, 1 << 10), 4).modify).toBe('form');
    expect(permissionsFromBits(only(1 << 5, 1 << 8, 1 << 10), 4).modify).toBe('annotate');
    expect(permissionsFromBits(only(1 << 3), 4).modify).toBe('all');
  });
});
