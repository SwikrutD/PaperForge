import { randomUUID } from 'node:crypto';
import { AppError } from '@shared/errors/appError';
import type { ExportOptions, ExportPagePayload } from '@shared/schemas/convert';
import type { ExportResult } from '@shared/schemas/pages';
import {
  DocxWriter,
  HtmlWriter,
  ImageWriter,
  PptxWriter,
  TextWriter,
  XlsxWriter,
  type Writer,
  type WriterContext,
} from './writers';
import type { Logger } from '../logging/logger';

/**
 * One export, from the first page to the written file.
 *
 * The window sends a page at a time, so a three-hundred-page document never
 * has more than one picture in flight, and a run that is stopped leaves
 * behind only whatever was already written — which for a picture export is
 * the pages that finished, and for a document export is nothing at all.
 */
export class ExportSession {
  readonly id = randomUUID();
  private readonly writer: Writer;
  private readonly written: string[] = [];
  private cancelled = false;
  private finished = false;

  constructor(
    private readonly context: WriterContext,
    private readonly logger: Logger,
  ) {
    this.writer = writerFor(context);
  }

  get directory(): string {
    return this.context.directory;
  }

  async addPage(payload: ExportPagePayload): Promise<void> {
    if (this.cancelled) throw new AppError('op/cancelled', { details: 'export cancelled' });
    if (this.finished) {
      throw new AppError('internal/unexpected', { message: 'That export has already finished.' });
    }
    this.written.push(...(await this.writer.addPage(payload)));
  }

  async finish(): Promise<ExportResult> {
    if (this.cancelled) return { canceled: true, paths: this.written, directory: this.directory };

    this.finished = true;
    this.written.push(...(await this.writer.finish()));
    this.logger.info(
      'Exported a document.',
      this.context.options.mode,
      `${this.written.length} files`,
    );

    return { canceled: false, paths: this.written, directory: this.directory };
  }

  cancel(): ExportResult {
    this.cancelled = true;
    return { canceled: true, paths: this.written, directory: this.directory };
  }
}

function writerFor(context: WriterContext): Writer {
  switch (context.options.mode) {
    case 'png':
    case 'jpeg':
    case 'webp':
      return new ImageWriter(context);
    case 'txt':
      return new TextWriter(context);
    case 'html':
      return new HtmlWriter(context);
    case 'docx':
      return new DocxWriter(context);
    case 'xlsx':
      return new XlsxWriter(context);
    case 'pptx':
      return new PptxWriter(context);
  }
}

/** The exports a window has in flight. */
export class ExportSessions {
  private readonly sessions = new Map<string, ExportSession>();

  constructor(private readonly logger: Logger) {}

  start(context: WriterContext): ExportSession {
    const session = new ExportSession(context, this.logger);
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string): ExportSession {
    const session = this.sessions.get(id);
    if (session === undefined) {
      throw new AppError('internal/unexpected', {
        message: 'That export is no longer running.',
        details: id,
      });
    }
    return session;
  }

  async finish(id: string): Promise<ExportResult> {
    const session = this.get(id);
    try {
      return await session.finish();
    } finally {
      this.sessions.delete(id);
    }
  }

  cancel(id: string): ExportResult {
    const session = this.sessions.get(id);
    if (session === undefined) return { canceled: true, paths: [], directory: null };
    this.sessions.delete(id);
    return session.cancel();
  }
}

/** What a mode writes, for the dialog to say before anything is chosen. */
export function describeOutput(options: ExportOptions, pageCount: number): string {
  switch (options.mode) {
    case 'png':
    case 'jpeg':
    case 'webp':
      return `${String(pageCount)} picture${pageCount === 1 ? '' : 's'}`;
    case 'txt':
      return 'one text file';
    case 'html':
      return options.includePageImages
        ? 'one web page and a folder of pictures beside it'
        : 'one web page';
    case 'docx':
      return 'one Word document';
    case 'xlsx':
      return 'one workbook, a sheet to a page';
    case 'pptx':
      return `one deck of ${String(pageCount)} slide${pageCount === 1 ? '' : 's'}`;
  }
}
