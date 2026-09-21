/**
 * Content Security Policy for the renderer.
 *
 * Production serves the renderer from the app:// scheme, so 'self' means the
 * packaged bundle and nothing else. blob:/data: stay allowed for images and
 * workers because PDF rendering needs them. Development additionally allows the
 * Vite dev server origin plus its websocket and the inline preamble React
 * Refresh injects.
 */
export function buildContentSecurityPolicy(devServerOrigin?: string): string {
  const devHttp = devServerOrigin ?? '';
  const devWs = devServerOrigin === undefined ? '' : devServerOrigin.replace(/^http/, 'ws');

  const scriptSrc = devServerOrigin === undefined ? `'self'` : `'self' 'unsafe-inline' ${devHttp}`;
  const connectSrc =
    devServerOrigin === undefined ? `'self' blob: data:` : `'self' blob: data: ${devHttp} ${devWs}`;

  return [
    `default-src 'none'`,
    `script-src ${scriptSrc}`,
    // Style attributes and runtime-injected stylesheets are unavoidable with
    // React component styling; scripts remain strictly controlled.
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self' data:`,
    `media-src 'self' blob:`,
    `connect-src ${connectSrc}`,
    `worker-src 'self' blob:`,
    `child-src 'self' blob:`,
    `object-src 'none'`,
    `base-uri 'none'`,
    `form-action 'none'`,
    `frame-src 'none'`,
    `frame-ancestors 'none'`,
    `manifest-src 'none'`,
  ].join('; ');
}
