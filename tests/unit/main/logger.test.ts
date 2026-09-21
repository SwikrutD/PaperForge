import { describe, expect, it } from 'vitest';
import { parseLogLevel, redactSensitive } from '../../../src/main/services/logging/logger';

describe('logging', () => {
  it('redacts secrets in any common shape', () => {
    expect(redactSensitive('open password: hunter2')).toBe('open password: ***');
    expect(redactSensitive('{"ownerPassword":"s3cret"}')).toContain('***');
    expect(redactSensitive('token = abc123')).toBe('token = ***');
  });

  it('leaves ordinary text alone', () => {
    const windowsPath = String.raw`Opened C:\\Docs\\report.pdf`;
    expect(redactSensitive(windowsPath)).toBe(windowsPath);
  });

  it('falls back when the configured level is unknown', () => {
    expect(parseLogLevel('debug', 'info')).toBe('debug');
    expect(parseLogLevel('verbose', 'info')).toBe('info');
    expect(parseLogLevel(undefined, 'warn')).toBe('warn');
  });
});
