import { z } from 'zod';

/**
 * Files carried inside a document.
 *
 * PaperForge never opens one and never runs one. An attachment is listed, its
 * bytes are written to disk only when the reader asks, and a file whose name
 * suggests it can run code is called out before that happens.
 */

export const embeddedFileSchema = z.strictObject({
  /** Stable within a revision: the name the document files it under. */
  id: z.string().min(1).max(500),
  fileName: z.string().min(1).max(500),
  description: z.string().max(2000).nullable(),
  /** Bytes, from /Params /Size or the stream itself; null when neither says. */
  sizeBytes: z.number().int().nonnegative().nullable(),
  /** The subtype the document states, e.g. "application/pdf". */
  mimeType: z.string().max(200).nullable(),
  /** ISO 8601, from /Params; null when the document states none. */
  createdAt: z.string().max(60).nullable(),
  modifiedAt: z.string().max(60).nullable(),
  /** True when the extension is one Windows can execute or script. */
  risky: z.boolean(),
});
export type EmbeddedFile = z.infer<typeof embeddedFileSchema>;

/** Names an attachment the main process has staged, ready to be embedded. */
export const stagedAttachmentSchema = z.strictObject({
  token: z.string().min(1).max(200),
  fileName: z.string().min(1).max(500),
  sizeBytes: z.number().int().nonnegative(),
  risky: z.boolean(),
});
export type StagedAttachment = z.infer<typeof stagedAttachmentSchema>;

export const saveAttachmentOutcomeSchema = z.strictObject({
  canceled: z.boolean(),
  path: z.string().nullable(),
});
export type SaveAttachmentOutcome = z.infer<typeof saveAttachmentOutcomeSchema>;

/** Extensions Windows will run, script or trust in a way a document should not. */
export const RISKY_ATTACHMENT_EXTENSIONS: ReadonlySet<string> = new Set([
  'ade',
  'adp',
  'app',
  'application',
  'appref-ms',
  'asp',
  'bas',
  'bat',
  'cer',
  'chm',
  'cmd',
  'com',
  'cpl',
  'crt',
  'csh',
  'diagcab',
  'exe',
  'fxp',
  'gadget',
  'hlp',
  'hta',
  'htc',
  'inf',
  'ins',
  'isp',
  'its',
  'jar',
  'js',
  'jse',
  'ksh',
  'lnk',
  'mad',
  'maf',
  'mag',
  'mam',
  'maq',
  'mar',
  'mas',
  'mat',
  'mau',
  'mav',
  'maw',
  'mcf',
  'mda',
  'mdb',
  'mde',
  'mdt',
  'mdw',
  'mdz',
  'msc',
  'msh',
  'msh1',
  'msh2',
  'mshxml',
  'msi',
  'msp',
  'mst',
  'ops',
  'osd',
  'pcd',
  'pif',
  'pl',
  'plg',
  'prf',
  'prg',
  'ps1',
  'ps1xml',
  'ps2',
  'ps2xml',
  'psc1',
  'psc2',
  'pst',
  'py',
  'pyc',
  'pyw',
  'reg',
  'scf',
  'scr',
  'sct',
  'shb',
  'shs',
  'theme',
  'tmp',
  'url',
  'vb',
  'vbe',
  'vbp',
  'vbs',
  'vsmacros',
  'vsw',
  'webpnp',
  'website',
  'ws',
  'wsc',
  'wsf',
  'wsh',
  'xbap',
  'xll',
  'xnk',
]);

/** True when the name ends in an extension Windows treats as executable. */
export function isRiskyAttachmentName(fileName: string): boolean {
  const index = fileName.lastIndexOf('.');
  if (index < 0) return false;
  return RISKY_ATTACHMENT_EXTENSIONS.has(fileName.slice(index + 1).toLowerCase());
}
