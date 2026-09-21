import { app, type Session, type WebContents } from 'electron';
import type { Logger } from '../services/logging/logger';

/**
 * Applies the Electron security baseline to a web contents:
 * no popups, no navigation away from trusted origins, no webviews.
 * Opening external URLs is a deliberate, user-confirmed action that a later
 * segment adds through IPC — never something a document can trigger.
 */
export function hardenWebContents(
  contents: WebContents,
  trustedOrigins: readonly string[],
  logger: Logger,
): void {
  const isTrusted = (url: string): boolean =>
    trustedOrigins.some((origin) => url === origin || url.startsWith(`${origin}/`));

  contents.setWindowOpenHandler(({ url }) => {
    logger.warn('Blocked a window.open request.', url);
    return { action: 'deny' };
  });

  contents.on('will-navigate', (event, url) => {
    if (isTrusted(url)) return;
    event.preventDefault();
    logger.warn('Blocked navigation to an untrusted URL.', url);
  });

  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
    logger.warn('Blocked a webview attachment.');
  });

  contents.on('will-frame-navigate', (event) => {
    if (isTrusted(event.url)) return;
    event.preventDefault();
    logger.warn('Blocked a frame navigation to an untrusted URL.', event.url);
  });
}

/** Denies every permission request; PaperForge needs none of them. */
export function hardenSession(session: Session, logger: Logger): void {
  session.setPermissionRequestHandler((_contents, permission, callback) => {
    logger.warn('Denied a permission request.', permission);
    callback(false);
  });
  session.setPermissionCheckHandler(() => false);
  session.setDevicePermissionHandler(() => false);
  session.setBluetoothPairingHandler((_details, callback) => callback({ confirmed: false }));
}

/**
 * Adds the CSP and nosniff headers to responses from an http(s) origin.
 * Production responses get their headers from the app:// protocol handler
 * instead, because the webRequest API does not observe custom schemes.
 */
export function applyDevSecurityHeaders(session: Session, policy: string, origin: string): void {
  session.webRequest.onHeadersReceived({ urls: [`${origin}/*`] }, (details, callback) => {
    const headers = { ...details.responseHeaders };
    delete headers['content-security-policy'];
    delete headers['Content-Security-Policy'];
    headers['Content-Security-Policy'] = [policy];
    headers['X-Content-Type-Options'] = ['nosniff'];
    callback({ responseHeaders: headers });
  });
}

/** Refuses TLS errors outright instead of prompting; PaperForge is offline. */
export function rejectInsecureCertificates(logger: Logger): void {
  app.on('certificate-error', (event, _contents, url, error) => {
    event.preventDefault();
    logger.warn('Rejected a certificate error.', url, error);
  });
}
