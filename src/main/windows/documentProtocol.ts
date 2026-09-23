import { protocol } from 'electron';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import { Readable } from 'node:stream';
import { DOCUMENT_HOST, DOCUMENT_SCHEME, SOURCE_HOST } from '@shared/constants/app';
import type { DocumentService } from '../services/documents/documentService';
import { contentRangeHeader, parseRangeHeader } from '../services/documents/rangeHeader';
import type { Logger } from '../services/logging/logger';

/** Must run before the app is ready. */
export function registerDocumentScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: DOCUMENT_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ]);
}

function deny(status: number, reason: string): Response {
  return new Response(reason, { status, headers: { 'Content-Type': 'text/plain' } });
}

/**
 * Serves the bytes of an open document to the renderer over
 * `pfdoc://document/<session id>`.
 *
 * The renderer never learns a path: it asks for a session it already has, and
 * only sessions that are currently open resolve. Range requests are honoured so
 * the viewer can show the first page of a large file without reading all of it.
 */
export function registerDocumentProtocol(
  documents: DocumentService,
  logger: Logger,
  /** Where a session's bytes currently live, when it has unsaved changes. */
  currentBytesPath: (sessionId: string) => string | undefined = () => undefined,
  /** Bytes of a file staged for a new document, for previewing it. */
  sourceBytes: (sourceId: string) => Uint8Array | undefined = () => undefined,
): void {
  protocol.handle(DOCUMENT_SCHEME, async (request) => {
    const url = new URL(request.url);
    const id = decodeURIComponent(url.pathname.replace(/^\/+/, ''));

    if (url.host === SOURCE_HOST) {
      const bytes = sourceBytes(id);
      if (bytes === undefined) {
        logger.warn('Refused a preview request for an unknown source.', id);
        return deny(404, 'Not found');
      }
      return servedBytes(bytes, request.headers.get('Range'));
    }

    if (url.host !== DOCUMENT_HOST) return deny(404, 'Not found');

    const sessionId = id;
    const session = documents.get(sessionId);
    if (session === undefined) {
      logger.warn('Refused a document request for an unknown session.', sessionId);
      return deny(404, 'Not found');
    }

    const filePath = currentBytesPath(sessionId) ?? session.file.path;
    let size: number;
    try {
      size = (await fs.stat(filePath)).size;
    } catch {
      return deny(404, 'The file is no longer available');
    }

    const parsed = parseRangeHeader(request.headers.get('Range'), size);
    if (parsed.kind === 'unsatisfiable') {
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${size}`, 'Accept-Ranges': 'bytes' },
      });
    }

    const headers = new Headers({
      'Content-Type': 'application/pdf',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });

    if (parsed.kind === 'full') {
      headers.set('Content-Length', String(size));
      return new Response(streamFile(filePath), { status: 200, headers });
    }

    const { start, end } = parsed.range;
    headers.set('Content-Length', String(end - start + 1));
    headers.set('Content-Range', contentRangeHeader(parsed.range, size));
    return new Response(streamFile(filePath, start, end), { status: 206, headers });
  });
}

/** Serves bytes PaperForge is holding, with the range support PDF.js expects. */
function servedBytes(bytes: Uint8Array, range: string | null): Response {
  const parsed = parseRangeHeader(range, bytes.byteLength);
  if (parsed.kind === 'unsatisfiable') {
    return new Response(null, {
      status: 416,
      headers: { 'Content-Range': `bytes */${String(bytes.byteLength)}`, 'Accept-Ranges': 'bytes' },
    });
  }

  const headers = new Headers({
    'Content-Type': 'application/pdf',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });

  if (parsed.kind === 'full') {
    headers.set('Content-Length', String(bytes.byteLength));
    return new Response(bytes.slice(), { status: 200, headers });
  }

  const { start, end } = parsed.range;
  headers.set('Content-Length', String(end - start + 1));
  headers.set('Content-Range', contentRangeHeader(parsed.range, bytes.byteLength));
  return new Response(bytes.slice(start, end + 1), { status: 206, headers });
}

function streamFile(filePath: string, start?: number, end?: number): ReadableStream<Uint8Array> {
  const stream =
    start === undefined || end === undefined
      ? createReadStream(filePath)
      : createReadStream(filePath, { start, end });
  return Readable.toWeb(stream) as ReadableStream<Uint8Array>;
}
