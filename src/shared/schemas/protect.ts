import { z } from 'zod';

/**
 * Document security, as the PDF standard security handler describes it.
 *
 * PDF permissions are cooperative: they are flags a conforming reader agrees
 * to honour, not enforcement. PaperForge writes and reports them accurately
 * and says nothing about what other software will do with them.
 */

/** None, a degraded copy, or the document as it is. */
export const printPermissionSchema = z.enum(['none', 'low', 'full']);
export type PrintPermission = z.infer<typeof printPermissionSchema>;

/** How much of the document may be changed, from least to most. */
export const modifyPermissionSchema = z.enum(['none', 'assembly', 'form', 'annotate', 'all']);
export type ModifyPermission = z.infer<typeof modifyPermissionSchema>;

export const documentPermissionsSchema = z.strictObject({
  print: printPermissionSchema,
  modify: modifyPermissionSchema,
  /** Copying text and graphics out of the document. */
  extract: z.boolean(),
  /** Extraction for assistive technology, which older readers treat apart. */
  extractForAccessibility: z.boolean(),
  fillForms: z.boolean(),
  annotate: z.boolean(),
  /** Inserting, rotating and deleting pages. */
  assemble: z.boolean(),
});
export type DocumentPermissions = z.infer<typeof documentPermissionsSchema>;

/** Everything allowed, which is what an unprotected document means. */
export const ALL_PERMISSIONS: DocumentPermissions = {
  print: 'full',
  modify: 'all',
  extract: true,
  extractForAccessibility: true,
  fillForms: true,
  annotate: true,
  assemble: true,
};

export const securitySummarySchema = z.strictObject({
  encrypted: z.boolean(),
  /** The security handler's name, normally "Standard". */
  handler: z.string().nullable(),
  /** "RC4 40-bit", "AES-128", "AES-256" — how the document is encrypted. */
  algorithm: z.string().nullable(),
  keyLengthBits: z.number().int().nullable(),
  /** /V and /R from the encryption dictionary, for diagnostics. */
  version: z.number().int().nullable(),
  revision: z.number().int().nullable(),
  /** False when the document's metadata was deliberately left in the clear. */
  encryptMetadata: z.boolean().nullable(),
  permissions: documentPermissionsSchema.nullable(),
  /** The raw /P value the permissions were read from. */
  permissionBits: z.number().int().nullable(),
  /**
   * True when a password is needed to open the document at all, as opposed to
   * one that only lifts the restrictions. Null when it could not be told
   * apart, which is what happens without qpdf.
   */
  openPasswordRequired: z.boolean().nullable(),
});
export type SecuritySummary = z.infer<typeof securitySummarySchema>;

export const UNENCRYPTED_SUMMARY: SecuritySummary = {
  encrypted: false,
  handler: null,
  algorithm: null,
  keyLengthBits: null,
  version: null,
  revision: null,
  encryptMetadata: null,
  permissions: null,
  permissionBits: null,
  openPasswordRequired: false,
};

/**
 * The permissions that can be written, as opposed to the ones that can be
 * read.
 *
 * The standard security handler has more bits than any tool offers separately:
 * what a writer really controls is printing, how much may be changed, whether
 * content can be copied, and whether assistive software may read it. The rest
 * follow from the "changing" ladder, and a document that claimed otherwise
 * would be describing bits nobody sets independently.
 */
export const permissionChoicesSchema = z.strictObject({
  print: printPermissionSchema,
  modify: modifyPermissionSchema,
  extract: z.boolean(),
  /** Not available at 40 bits, where the handler has no separate bit for it. */
  extractForAccessibility: z.boolean(),
});
export type PermissionChoices = z.infer<typeof permissionChoicesSchema>;

export const DEFAULT_PERMISSION_CHOICES: PermissionChoices = {
  print: 'full',
  modify: 'all',
  extract: true,
  extractForAccessibility: true,
};

/** Key lengths qpdf will write. 40-bit RC4 exists only for old readers. */
export const keyLengthSchema = z.union([z.literal(40), z.literal(128), z.literal(256)]);
export type KeyLength = z.infer<typeof keyLengthSchema>;

const passwordSchema = z.string().max(200);

/**
 * Writes a protected copy of the open document.
 *
 * An empty password means "do not ask for one": an empty open password lets
 * anyone open the file while the permissions still apply, and an empty
 * permissions password means the restrictions can be lifted by anyone who
 * knows to try.
 */
export const protectRequestSchema = z.strictObject({
  sessionId: z.string().min(1),
  openPassword: passwordSchema,
  permissionsPassword: passwordSchema,
  keyLengthBits: keyLengthSchema,
  permissions: permissionChoicesSchema,
  /** Leaving metadata in the clear lets indexers read it; off by default. */
  encryptMetadata: z.boolean(),
});
export type ProtectRequest = z.infer<typeof protectRequestSchema>;

/** Writes a copy of the open document with its security removed. */
export const unprotectRequestSchema = z.strictObject({
  sessionId: z.string().min(1),
  password: passwordSchema,
});
export type UnprotectRequest = z.infer<typeof unprotectRequestSchema>;

export const protectOutcomeSchema = z.strictObject({
  /** True when the reader dismissed the file dialog. */
  canceled: z.boolean(),
  /** Where the new document was written. */
  path: z.string().nullable(),
});
export type ProtectOutcome = z.infer<typeof protectOutcomeSchema>;
