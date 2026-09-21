import { describe, expect, it } from 'vitest';
import { buildContentSecurityPolicy } from '../../../src/main/security/csp';

describe('content security policy', () => {
  it('locks production down to the packaged bundle', () => {
    const policy = buildContentSecurityPolicy();
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("script-src 'self'");
    expect(policy).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(policy).not.toContain('unsafe-eval');
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
  });

  it('keeps worker and blob sources available for PDF rendering', () => {
    const policy = buildContentSecurityPolicy();
    expect(policy).toContain("worker-src 'self' blob:");
    expect(policy).toContain('img-src');
  });

  it('allows only the dev server origin and its websocket in development', () => {
    const policy = buildContentSecurityPolicy('http://localhost:5173');
    expect(policy).toContain("script-src 'self' 'unsafe-inline' http://localhost:5173");
    expect(policy).toContain('ws://localhost:5173');
    expect(policy).not.toContain('https://');
  });
});
