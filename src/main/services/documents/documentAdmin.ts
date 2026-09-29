import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppError } from '@shared/errors/appError';
import type { EmbeddedFile } from '@shared/schemas/attachment';
import { isRiskyAttachmentName, type StagedAttachment } from '@shared/schemas/attachment';
import type { DocumentProperties } from '@shared/schemas/metadata';
import type { ProtectRequest } from '@shared/schemas/protect';
import type { SanitizeReport } from '@shared/schemas/sanitize';
import { readSecuritySummary } from '@pdf/security/summary';
import type { PdfMutationEngine } from '@pdf/mutate/types';
import { writeFileAtomic } from '../filesystem/atomicWrite';
import type { Logger } from '../logging/logger';
import type { QpdfSecurity } from '../qpdf/qpdfSecurity';
import type { StagedAssets } from './stagedAssets';

/** A file worth carrying inside a document, but not one worth refusing to. */
const MAX_ATTACHMENT_BYTES = 256 * 1024 * 1024;

/** Where qpdf's input and output go while a protected copy is being made. */
const SECURITY_DIR_NAME = 'security';

export interface DocumentAdminDeps {
  engine: PdfMutationEngine;
  security: QpdfSecurity;
  stagedAssets: StagedAssets;
  logger: Logger;
  /** The bytes of the revision the reader is looking at. */
  currentBytes: (sessionId: string) => Promise<Uint8Array>;
  /** The working directory PaperForge owns for a session. */
  workspaceDirectory: (sessionId: string) => string;
}

/**
 * Document administration: properties, attachments, hidden information and
 * security.
 *
 * Everything reads the revision the reader is looking at, so what the panels
 * show is what an unsaved change has made of the document. Protecting a
 * document writes a new file and never touches the one that is open: an
 * encrypted document cannot be edited, and silently swapping one in for the
 * other would take the reader's work away.
 */
export class DocumentAdmin {
  constructor(private readonly deps: DocumentAdminDeps) {}

  /** What the document says about itself, plus what its bytes say about security. */
  async properties(sessionId: string): Promise<DocumentProperties> {
    const bytes = await this.deps.currentBytes(sessionId);
    const content = await this.deps.engine.readProperties(bytes);
    return { ...content, security: readSecuritySummary(bytes) };
  }

  async attachments(sessionId: string): Promise<EmbeddedFile[]> {
    return this.deps.engine.readAttachments(await this.deps.currentBytes(sessionId));
  }

  async scan(sessionId: string): Promise<SanitizeReport> {
    return this.deps.engine.scanHiddenInformation(await this.deps.currentBytes(sessionId));
  }

  /**
   * Stages a file to be carried inside the document.
   *
   * The bytes stay in the main process; the renderer is handed a token and
   * told whether the file is one Windows would run, so it can say so before
   * the attachment is added.
   */
  async stageAttachment(sessionId: string, filePath: string): Promise<StagedAttachment> {
    const stats = await fs.stat(filePath).catch(() => null);
    if (stats === null || !stats.isFile()) {
      throw new AppError('io/not-found', {
        message: 'That file could not be read.',
        details: filePath,
      });
    }
    if (stats.size > MAX_ATTACHMENT_BYTES) {
      throw new AppError('internal/unexpected', {
        message: 'That file is too large to carry inside a PDF.',
        details: `${String(Math.round(stats.size / 1024 / 1024))} MB; the limit is 256 MB`,
      });
    }

    const fileName = path.basename(filePath);
    const token = this.deps.stagedAssets.stageFile(sessionId, {
      bytes: new Uint8Array(await fs.readFile(filePath)),
      fileName,
      mimeType: mimeTypeFor(fileName),
      modifiedAt: new Date(stats.mtimeMs),
    });

    return {
      token,
      fileName,
      sizeBytes: stats.size,
      risky: isRiskyAttachmentName(fileName),
    };
  }

  /**
   * Writes one attachment out to disk.
   *
   * PaperForge does not open it and does not ask Windows to. The bytes are
   * written where the reader chose and that is the end of PaperForge's part
   * in it (CLAUDE.md section 25).
   */
  async saveAttachment(sessionId: string, id: string, destination: string): Promise<void> {
    const bytes = await this.deps.currentBytes(sessionId);
    const attachment = await this.deps.engine.extractAttachment(bytes, id);

    if (attachment === null) {
      throw new AppError('io/not-found', {
        message: 'That attachment is no longer in this document.',
        details: id,
      });
    }

    await writeFileAtomic(destination, attachment.bytes);
    this.deps.logger.info(
      'Saved an attachment.',
      attachment.risky ? 'executable type' : 'ordinary type',
      String(attachment.bytes.length),
    );
  }

  /** Writes an encrypted copy of the open document. */
  async protect(sessionId: string, request: ProtectRequest, destination: string): Promise<void> {
    await this.throughQpdf(sessionId, destination, async (input, output) => {
      await this.deps.security.encrypt(input, output, request);
    });

    this.deps.logger.info(
      'Wrote a protected copy.',
      `${String(request.keyLengthBits)}-bit`,
      request.openPassword === '' ? 'no open password' : 'open password set',
    );
  }

  /** Writes a copy of the open document with its security removed. */
  async unprotect(sessionId: string, password: string, destination: string): Promise<void> {
    await this.throughQpdf(sessionId, destination, async (input, output) => {
      await this.deps.security.decrypt(input, output, password);
    });

    this.deps.logger.info('Wrote an unprotected copy.');
  }

  /**
   * Runs the current revision through qpdf and publishes the result.
   *
   * The reader's file is only replaced once qpdf's output has been read back
   * and found to be a PDF, and the working copies are removed whether that
   * succeeded or not.
   */
  private async throughQpdf(
    sessionId: string,
    destination: string,
    run: (input: string, output: string) => Promise<void>,
  ): Promise<void> {
    if (!(await this.deps.security.available())) {
      throw new AppError('sidecar/missing', {
        message: 'qpdf is needed to change a document’s security, and is not installed.',
        details:
          'Install qpdf and restart PaperForge, or point Settings → Local tools at a copy of it.',
      });
    }

    const directory = path.join(this.deps.workspaceDirectory(sessionId), SECURITY_DIR_NAME);
    await fs.mkdir(directory, { recursive: true });

    const stem = randomUUID();
    const input = path.join(directory, `${stem}-in.pdf`);
    const output = path.join(directory, `${stem}-out.pdf`);

    try {
      await fs.writeFile(input, await this.deps.currentBytes(sessionId));
      await run(input, output);

      const written = await fs.readFile(output).catch(() => null);
      if (written === null || written.length === 0) {
        throw new AppError('io/write-failed', {
          message: 'qpdf produced nothing.',
          details: 'The document you have open is unchanged.',
        });
      }
      if (!startsWithPdfHeader(written)) {
        throw new AppError('io/write-failed', {
          message: 'What qpdf produced is not a PDF.',
          details: 'The document you have open is unchanged.',
        });
      }

      await writeFileAtomic(destination, written);
    } finally {
      await fs.rm(input, { force: true }).catch(() => undefined);
      await fs.rm(output, { force: true }).catch(() => undefined);
    }
  }
}

function startsWithPdfHeader(bytes: Uint8Array): boolean {
  const header = '%PDF-';
  if (bytes.length < header.length) return false;
  for (let index = 0; index < header.length; index += 1) {
    if (bytes[index] !== header.charCodeAt(index)) return false;
  }
  return true;
}

/** Media types for the extensions worth naming; null means "do not guess". */
const MIME_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  txt: 'text/plain',
  csv: 'text/csv',
  html: 'text/html',
  htm: 'text/html',
  xml: 'application/xml',
  json: 'application/json',
  rtf: 'application/rtf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  zip: 'application/zip',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
};

export function mimeTypeFor(fileName: string): string | null {
  const index = fileName.lastIndexOf('.');
  if (index < 0) return null;
  return MIME_TYPES[fileName.slice(index + 1).toLowerCase()] ?? null;
}
