import type {
  DocumentPermissions,
  ModifyPermission,
  PrintPermission,
} from '@shared/schemas/protect';

/**
 * Reads the encryption dictionary straight out of the bytes.
 *
 * An encrypted document cannot be opened by the write engine at all, so the
 * security summary has to come from the file itself. The encryption dictionary
 * and the trailer are never encrypted — that is what makes this possible —
 * so a textual read of them is enough and nothing has to be decrypted.
 */

/** Permission bits, as PDF 32000-1 table 22 numbers them (1-based). */
const BIT_PRINT = 1 << 2;
const BIT_MODIFY = 1 << 3;
const BIT_EXTRACT = 1 << 4;
const BIT_ANNOTATE = 1 << 5;
const BIT_FILL_FORMS = 1 << 8;
const BIT_ACCESSIBILITY = 1 << 9;
const BIT_ASSEMBLE = 1 << 10;
const BIT_PRINT_HIGH = 1 << 11;

export interface EncryptionDictionary {
  /** /Filter, normally "Standard". */
  handler: string | null;
  version: number | null;
  revision: number | null;
  keyLengthBits: number | null;
  permissionBits: number | null;
  encryptMetadata: boolean;
  /** The crypt filter method for streams, when /V is 4 or 5. */
  streamMethod: string | null;
  /** /O and /U, needed to check whether a password is required to open. */
  ownerValue: Buffer | null;
  userValue: Buffer | null;
  /** /OE and /UE, the AES-256 key wrappers. */
  ownerKey: Buffer | null;
  userKey: Buffer | null;
  /** The first element of the trailer's /ID, which older revisions hash in. */
  fileId: Buffer | null;
}

/**
 * The encryption dictionary, or null when the document is not encrypted.
 *
 * The whole buffer is searched because a linearized or incrementally updated
 * file can carry several trailers; the last /Encrypt reference wins, which is
 * the one belonging to the most recent revision.
 */
export function readEncryptionDictionary(bytes: Uint8Array): EncryptionDictionary | null {
  const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1');

  const dictionary = findEncryptDictionary(text);
  if (dictionary === null) return null;

  const version = numberEntry(dictionary, 'V');
  const revision = numberEntry(dictionary, 'R');
  const declaredLength = numberEntry(dictionary, 'Length');
  const streamMethod = cryptFilterMethod(dictionary, nameEntry(dictionary, 'StmF'));

  return {
    handler: nameEntry(dictionary, 'Filter'),
    version,
    revision,
    keyLengthBits: keyLength(version, declaredLength, streamMethod),
    permissionBits: numberEntry(dictionary, 'P'),
    // Absent means true: the standard handler encrypts metadata by default.
    encryptMetadata: booleanEntry(dictionary, 'EncryptMetadata') ?? true,
    streamMethod,
    ownerValue: stringEntry(dictionary, 'O'),
    userValue: stringEntry(dictionary, 'U'),
    ownerKey: stringEntry(dictionary, 'OE'),
    userKey: stringEntry(dictionary, 'UE'),
    fileId: firstFileId(text),
  };
}

/** "AES-256", "RC4 128-bit" — what the dictionary says it used. */
export function describeAlgorithm(dictionary: EncryptionDictionary): string | null {
  if (dictionary.handler !== null && dictionary.handler !== 'Standard') {
    return `${dictionary.handler} security handler`;
  }

  const method = dictionary.streamMethod;
  if (method === 'AESV3') return 'AES-256';
  if (method === 'AESV2') return 'AES-128';
  if (method === 'None') return 'None';

  const bits = dictionary.keyLengthBits;
  if (dictionary.version === 5) return 'AES-256';
  if (bits === null) return 'RC4';
  return `RC4 ${String(bits)}-bit`;
}

/** Turns the /P bit field into the permissions PaperForge talks about. */
export function permissionsFromBits(bits: number, revision: number): DocumentPermissions {
  const allowed = (mask: number): boolean => (bits & mask) !== 0;
  // Revision 2 has none of the finer-grained bits, so the coarse ones stand in.
  const modern = revision >= 3;

  const print: PrintPermission = !allowed(BIT_PRINT)
    ? 'none'
    : modern && !allowed(BIT_PRINT_HIGH)
      ? 'low'
      : 'full';

  const assemble = modern ? allowed(BIT_ASSEMBLE) : allowed(BIT_MODIFY);
  const fillForms = modern ? allowed(BIT_FILL_FORMS) : allowed(BIT_ANNOTATE);

  const modify: ModifyPermission = allowed(BIT_MODIFY)
    ? 'all'
    : allowed(BIT_ANNOTATE)
      ? 'annotate'
      : fillForms
        ? 'form'
        : assemble
          ? 'assembly'
          : 'none';

  return {
    print,
    modify,
    extract: allowed(BIT_EXTRACT),
    extractForAccessibility: modern ? allowed(BIT_ACCESSIBILITY) : allowed(BIT_EXTRACT),
    fillForms,
    annotate: allowed(BIT_ANNOTATE),
    assemble,
  };
}

// ------------------------------------------------------------- parsing ---

/**
 * Finds the encryption dictionary's text.
 *
 * `/Encrypt` in a trailer is nearly always an indirect reference, so the
 * object it names is looked up; a direct dictionary is taken as it stands.
 */
function findEncryptDictionary(text: string): string | null {
  const references = [...text.matchAll(/\/Encrypt\s+(\d+)\s+(\d+)\s+R/g)];
  const last = references[references.length - 1];
  if (last !== undefined) {
    const objectNumber = last[1] ?? '';
    const generation = last[2] ?? '';
    const body = findObject(text, objectNumber, generation);
    if (body !== null) return body;
  }

  const direct = /\/Encrypt\s*<</.exec(text);
  if (direct === null) return null;
  return readDictionary(text, direct.index + direct[0].length - 2);
}

/** The body of `n g obj … endobj`, taking the last definition of it. */
function findObject(text: string, objectNumber: string, generation: string): string | null {
  const pattern = new RegExp(`(?:^|[^0-9])${objectNumber}\\s+${generation}\\s+obj\\b`, 'g');
  let found: string | null = null;

  for (const match of text.matchAll(pattern)) {
    const start = text.indexOf('<<', match.index);
    if (start < 0) continue;
    const end = text.indexOf('endobj', match.index);
    if (end >= 0 && start > end) continue;
    const dictionary = readDictionary(text, start);
    if (dictionary !== null) found = dictionary;
  }
  return found;
}

/** The text of a dictionary starting at `<<`, brackets balanced. */
function readDictionary(text: string, start: number): string | null {
  if (text.slice(start, start + 2) !== '<<') return null;

  let depth = 0;
  for (let index = start; index < text.length - 1; index += 1) {
    const pair = text.slice(index, index + 2);
    if (pair === '<<') {
      depth += 1;
      index += 1;
    } else if (pair === '>>') {
      depth -= 1;
      index += 1;
      if (depth === 0) return text.slice(start, index + 1);
    } else if (text[index] === '(') {
      index = skipLiteralString(text, index);
    }
  }
  return null;
}

/** Past a `(…)` string, so a `>>` inside one is not read as the end. */
function skipLiteralString(text: string, start: number): number {
  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (character === '\\') {
      index += 1;
      continue;
    }
    if (character === '(') depth += 1;
    else if (character === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return text.length;
}

function numberEntry(dictionary: string, key: string): number | null {
  const match = new RegExp(`/${key}\\s+(-?\\d+)(?![0-9.])`).exec(dictionary);
  if (match?.[1] === undefined) return null;
  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) ? value : null;
}

function nameEntry(dictionary: string, key: string): string | null {
  const match = new RegExp(`/${key}\\s*/([A-Za-z0-9.+_-]+)`).exec(dictionary);
  return match?.[1] ?? null;
}

function booleanEntry(dictionary: string, key: string): boolean | null {
  const match = new RegExp(`/${key}\\s+(true|false)\\b`).exec(dictionary);
  if (match?.[1] === undefined) return null;
  return match[1] === 'true';
}

/** A `(…)` or `<…>` string entry, as bytes. */
function stringEntry(dictionary: string, key: string): Buffer | null {
  const hex = new RegExp(`/${key}\\s*<([0-9A-Fa-f\\s]*)>`).exec(dictionary);
  if (hex?.[1] !== undefined) {
    const digits = hex[1].replace(/\s+/g, '');
    return Buffer.from(digits.length % 2 === 0 ? digits : `${digits}0`, 'hex');
  }

  const literal = new RegExp(`/${key}\\s*\\(`).exec(dictionary);
  if (literal === null) return null;
  const start = literal.index + literal[0].length - 1;
  const end = skipLiteralString(dictionary, start);
  return decodeLiteral(dictionary.slice(start + 1, end));
}

const ESCAPES: Record<string, number> = {
  n: 0x0a,
  r: 0x0d,
  t: 0x09,
  b: 0x08,
  f: 0x0c,
  '(': 0x28,
  ')': 0x29,
  '\\': 0x5c,
};

/** A PDF literal string's bytes, with its escapes resolved. */
function decodeLiteral(value: string): Buffer {
  const out: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] as string;
    if (character !== '\\') {
      out.push(character.charCodeAt(0) & 0xff);
      continue;
    }

    const next = value[index + 1];
    if (next === undefined) break;
    const escape = ESCAPES[next];
    if (escape !== undefined) {
      out.push(escape);
      index += 1;
      continue;
    }
    if (next >= '0' && next <= '7') {
      const octal = /^[0-7]{1,3}/.exec(value.slice(index + 1))?.[0] ?? '0';
      out.push(Number.parseInt(octal, 8) & 0xff);
      index += octal.length;
      continue;
    }
    // A backslash before anything else is dropped, as the specification says.
    index += 1;
    out.push(next.charCodeAt(0) & 0xff);
  }
  return Buffer.from(out);
}

/** The crypt filter's /CFM, which is where /V 4 and 5 state the algorithm. */
function cryptFilterMethod(dictionary: string, filterName: string | null): string | null {
  const name = filterName ?? 'StdCF';
  if (name === 'Identity') return 'None';

  const start = dictionary.indexOf('/CF');
  if (start < 0) return null;
  const filters = readDictionary(dictionary, dictionary.indexOf('<<', start));
  if (filters === null) return null;

  const entry = new RegExp(`/${name}\\s*<<`).exec(filters);
  if (entry === null) return nameEntry(filters, 'CFM');
  const filter = readDictionary(filters, entry.index + entry[0].length - 2);
  return filter === null ? null : nameEntry(filter, 'CFM');
}

function keyLength(
  version: number | null,
  declared: number | null,
  streamMethod: string | null,
): number | null {
  if (version === 5 || streamMethod === 'AESV3') return 256;
  if (streamMethod === 'AESV2') return 128;
  if (version === 1) return 40;
  // /Length is in bits for the encryption dictionary, unlike a crypt filter's.
  return declared;
}

/** The first half of the trailer's /ID, which revisions 2 to 4 hash in. */
function firstFileId(text: string): Buffer | null {
  const matches = [...text.matchAll(/\/ID\s*\[\s*<([0-9A-Fa-f\s]*)>/g)];
  const last = matches[matches.length - 1];
  if (last?.[1] === undefined) return null;
  const digits = last[1].replace(/\s+/g, '');
  return Buffer.from(digits.length % 2 === 0 ? digits : `${digits}0`, 'hex');
}
