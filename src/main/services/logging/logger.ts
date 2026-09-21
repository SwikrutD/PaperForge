import fs from 'node:fs';
import path from 'node:path';

const levels = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof levels)[number];

const MAX_LOG_BYTES = 1_000_000;

/** Values that must never reach a log file. */
const SENSITIVE_PATTERN =
  /(password|passphrase|secret|token)(["']?\s*[:=]\s*)("[^"]*"|'[^']*'|\S+)/gi;

export function redactSensitive(message: string): string {
  return message.replace(
    SENSITIVE_PATTERN,
    (_match, key: string, sep: string) => `${key}${sep}***`,
  );
}

export interface Logger {
  debug(message: string, ...details: unknown[]): void;
  info(message: string, ...details: unknown[]): void;
  warn(message: string, ...details: unknown[]): void;
  error(message: string, ...details: unknown[]): void;
}

export interface LoggerOptions {
  /** Directory for paperforge.log. Logging stays console-only when omitted. */
  directory?: string;
  level?: LogLevel;
}

function formatDetail(detail: unknown): string {
  if (detail instanceof Error) return `${detail.name}: ${detail.message}`;
  if (typeof detail === 'string') return detail;
  try {
    return JSON.stringify(detail);
  } catch {
    return '[unserializable]';
  }
}

function rotateIfNeeded(filePath: string): void {
  try {
    if (fs.statSync(filePath).size < MAX_LOG_BYTES) return;
    fs.renameSync(filePath, `${filePath}.1`);
  } catch {
    // Missing file or a locked previous log is not worth failing a write over.
  }
}

/**
 * Local-only logger. Logs stay on disk in the per-user logs directory and are
 * never transmitted anywhere. Document content is not logged.
 */
export function createLogger(options: LoggerOptions = {}): Logger {
  const minimumLevel = options.level ?? 'info';
  const threshold = levels.indexOf(minimumLevel);
  const filePath =
    options.directory === undefined ? undefined : path.join(options.directory, 'paperforge.log');

  if (options.directory !== undefined) {
    try {
      fs.mkdirSync(options.directory, { recursive: true });
    } catch {
      // Fall back to console-only logging.
    }
  }

  const write = (level: LogLevel, message: string, details: unknown[]): void => {
    if (levels.indexOf(level) < threshold) return;
    const suffix = details.length === 0 ? '' : ` ${details.map(formatDetail).join(' ')}`;
    const line = redactSensitive(
      `[${new Date().toISOString()}] ${level.toUpperCase()} ${message}${suffix}`,
    );

    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else process.stdout.write(`${line}\n`);

    if (filePath === undefined) return;
    rotateIfNeeded(filePath);
    try {
      fs.appendFileSync(filePath, `${line}\n`, 'utf8');
    } catch {
      // Never let logging break the app.
    }
  };

  return {
    debug: (message, ...details) => write('debug', message, details),
    info: (message, ...details) => write('info', message, details),
    warn: (message, ...details) => write('warn', message, details),
    error: (message, ...details) => write('error', message, details),
  };
}

export function parseLogLevel(value: string | undefined, fallback: LogLevel): LogLevel {
  return levels.find((level) => level === value) ?? fallback;
}
