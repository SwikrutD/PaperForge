import { createCipheriv, createHash } from 'node:crypto';
import type { EncryptionDictionary } from './encryptionDictionary';

/**
 * Enough of the standard security handler to answer one question: does this
 * document need a password before it can be opened at all?
 *
 * That is the distinction the Protect dialog has to make plainly — a document
 * locked shut is a different thing from one that merely asks not to be printed
 * — and it is the one the encryption dictionary does not state outright. The
 * answer comes from checking whether the empty user password validates, which
 * is what every reader does before prompting.
 *
 * Nothing here decrypts a document. PaperForge validates a password and stops.
 */

/** The padding string from PDF 32000-1, table 20. */
const PAD = Buffer.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

/**
 * True when the document opens without a password, false when one is needed,
 * and null when the handler is one PaperForge cannot check.
 */
export function opensWithoutPassword(dictionary: EncryptionDictionary): boolean | null {
  if (dictionary.handler !== null && dictionary.handler !== 'Standard') return null;
  const revision = dictionary.revision;
  if (revision === null) return null;

  if (revision >= 5) return checkRevision6(dictionary, '');
  if (revision >= 2 && revision <= 4) return checkRevision2to4(dictionary, '');
  return null;
}

/** Revisions 5 and 6: the user value carries its own validation salt. */
function checkRevision6(dictionary: EncryptionDictionary, password: string): boolean | null {
  const user = dictionary.userValue;
  if (user === null || user.length < 48) return null;

  const expected = user.subarray(0, 32);
  const validationSalt = user.subarray(32, 40);
  const bytes = Buffer.from(password, 'utf8').subarray(0, 127);

  const hash =
    dictionary.revision === 5
      ? createHash('sha256')
          .update(Buffer.concat([bytes, validationSalt]))
          .digest()
      : hash2B(bytes, validationSalt, Buffer.alloc(0));

  return hash.equals(expected);
}

/**
 * Algorithm 2.B: SHA-256 hardened by rounds of AES over the password.
 *
 * The loop runs at least 64 times and stops once the last byte of the round's
 * ciphertext is small enough, exactly as the specification states it.
 */
function hash2B(password: Buffer, salt: Buffer, userData: Buffer): Buffer {
  let k = createHash('sha256')
    .update(Buffer.concat([password, salt, userData]))
    .digest();

  for (let round = 0; ; round += 1) {
    const block = Buffer.concat([password, k, userData]);
    const k1 = Buffer.concat(Array.from({ length: 64 }, () => block));

    const cipher = createCipheriv('aes-128-cbc', k.subarray(0, 16), k.subarray(16, 32));
    cipher.setAutoPadding(false);
    const e = Buffer.concat([cipher.update(k1), cipher.final()]);

    let sum = 0;
    for (let index = 0; index < 16; index += 1) sum += e[index] ?? 0;
    const algorithm = ['sha256', 'sha384', 'sha512'][sum % 3] as string;
    k = createHash(algorithm).update(e).digest();

    const last = e[e.length - 1] ?? 0;
    if (round >= 63 && last <= round - 31) return k.subarray(0, 32);
  }
}

/** Revisions 2 to 4: rebuild the file key, then algorithm 6. */
function checkRevision2to4(dictionary: EncryptionDictionary, password: string): boolean | null {
  const owner = dictionary.ownerValue;
  const user = dictionary.userValue;
  const permissions = dictionary.permissionBits;
  const revision = dictionary.revision;
  if (owner === null || user === null || permissions === null || revision === null) return null;

  const key = fileKey(dictionary, password, owner, permissions, revision);
  if (key === null) return null;

  if (revision === 2) {
    return rc4(key, PAD).equals(user.subarray(0, 32));
  }

  const digest = createHash('md5')
    .update(Buffer.concat([PAD, dictionary.fileId ?? Buffer.alloc(0)]))
    .digest();

  let value = rc4(key, digest);
  for (let index = 1; index <= 19; index += 1) {
    const rotated = Buffer.from(key.map((byte) => byte ^ index));
    value = rc4(rotated, value);
  }
  // Only the first 16 bytes are meaningful; the rest is arbitrary padding.
  return value.equals(user.subarray(0, 16));
}

/** Algorithm 2: the file encryption key, from the padded password. */
function fileKey(
  dictionary: EncryptionDictionary,
  password: string,
  owner: Buffer,
  permissions: number,
  revision: number,
): Buffer | null {
  const lengthBits = dictionary.keyLengthBits ?? (revision === 2 ? 40 : 128);
  const lengthBytes = Math.floor(lengthBits / 8);
  if (lengthBytes < 5 || lengthBytes > 16) return null;

  const padded = Buffer.concat([Buffer.from(password, 'latin1').subarray(0, 32), PAD]).subarray(
    0,
    32,
  );
  const permissionBytes = Buffer.alloc(4);
  permissionBytes.writeInt32LE(permissions, 0);

  const parts = [
    padded,
    owner.subarray(0, 32),
    permissionBytes,
    dictionary.fileId ?? Buffer.alloc(0),
  ];
  // Revision 4 with metadata left in the clear hashes in four more bytes.
  if (revision >= 4 && !dictionary.encryptMetadata) {
    parts.push(Buffer.from([0xff, 0xff, 0xff, 0xff]));
  }

  let digest = createHash('md5').update(Buffer.concat(parts)).digest();
  if (revision >= 3) {
    for (let index = 0; index < 50; index += 1) {
      digest = createHash('md5').update(digest.subarray(0, lengthBytes)).digest();
    }
  }
  return digest.subarray(0, revision === 2 ? 5 : lengthBytes);
}

/** RC4, which is what revisions 2 to 4 of the standard handler use. */
function rc4(key: Buffer, data: Buffer): Buffer {
  const state = new Uint8Array(256);
  for (let index = 0; index < 256; index += 1) state[index] = index;

  let j = 0;
  for (let index = 0; index < 256; index += 1) {
    j = (j + (state[index] ?? 0) + (key[index % key.length] ?? 0)) & 0xff;
    [state[index], state[j]] = [state[j] ?? 0, state[index] ?? 0];
  }

  const output = Buffer.alloc(data.length);
  let x = 0;
  let y = 0;
  for (let index = 0; index < data.length; index += 1) {
    x = (x + 1) & 0xff;
    y = (y + (state[x] ?? 0)) & 0xff;
    [state[x], state[y]] = [state[y] ?? 0, state[x] ?? 0];
    const k = state[((state[x] ?? 0) + (state[y] ?? 0)) & 0xff] ?? 0;
    output[index] = (data[index] ?? 0) ^ k;
  }
  return output;
}
