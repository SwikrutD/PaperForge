import { net, protocol } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { RENDERER_HOST, RENDERER_SCHEME } from '@shared/constants/app';
import { resolveWithinRoot } from '../services/filesystem/pathSafety';
import type { Logger } from '../services/logging/logger';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

/** Must run before the app is ready. */
export function registerRendererScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: RENDERER_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
        codeCache: true,
      },
    },
  ]);
}

/**
 * Serves the packaged renderer from app://renderer/ instead of file://.
 *
 * This gives the renderer a real origin (so a strict CSP and normal fetch
 * semantics apply) and confines every request to the renderer output directory
 * with traversal protection.
 */
export function registerRendererProtocol(
  rendererRoot: string,
  contentSecurityPolicy: string,
  logger: Logger,
): void {
  protocol.handle(RENDERER_SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.host !== RENDERER_HOST) {
      return new Response('Not found', { status: 404 });
    }

    const requestedPath =
      url.pathname === '' || url.pathname === '/' ? '/index.html' : url.pathname;
    let decoded: string;
    try {
      decoded = decodeURIComponent(requestedPath);
    } catch {
      return new Response('Bad request', { status: 400 });
    }

    const resolved = resolveWithinRoot(rendererRoot, decoded);
    if (resolved === null) {
      logger.warn('Blocked an app:// request outside the renderer root.', decoded);
      return new Response('Forbidden', { status: 403 });
    }

    const fileResponse = await net.fetch(pathToFileURL(resolved).toString());
    if (!fileResponse.ok) {
      return new Response('Not found', { status: 404 });
    }

    const headers = new Headers(fileResponse.headers);
    headers.set('Content-Security-Policy', contentSecurityPolicy);
    headers.set('X-Content-Type-Options', 'nosniff');
    const contentType = CONTENT_TYPES[path.extname(resolved).toLowerCase()];
    if (contentType !== undefined) headers.set('Content-Type', contentType);

    return new Response(fileResponse.body, { status: 200, headers });
  });
}
