import { z } from 'zod';

/**
 * Error categories shared by every PaperForge subsystem. Codes are stable
 * identifiers; user-facing text is derived from them so messages stay
 * consistent and never leak stack traces by default.
 */
export const appErrorCodes = [
  'pdf/invalid',
  'pdf/encrypted',
  'pdf/wrong-password',
  'pdf/unsupported-encryption',
  'pdf/malformed-content',
  'io/not-found',
  'io/permission-denied',
  'io/write-failed',
  'io/out-of-space',
  'sidecar/missing',
  'ocr/failed',
  'conversion/provider-unavailable',
  'print/failed',
  'op/cancelled',
  'ipc/unknown-channel',
  'ipc/untrusted-sender',
  'ipc/invalid-request',
  'ipc/invalid-response',
  'settings/invalid',
  'internal/unexpected',
] as const;

export type AppErrorCode = (typeof appErrorCodes)[number];

const defaultMessages: Record<AppErrorCode, string> = {
  'pdf/invalid': 'This file is not a valid PDF.',
  'pdf/encrypted': 'This PDF is password protected.',
  'pdf/wrong-password': 'That password did not work.',
  'pdf/unsupported-encryption': 'This PDF uses an encryption method PaperForge cannot open.',
  'pdf/malformed-content': 'Part of this PDF is damaged.',
  'io/not-found': 'The file could not be found.',
  'io/permission-denied': 'Windows denied access to that location.',
  'io/write-failed': 'The file could not be written.',
  'io/out-of-space': 'There is not enough free disk space.',
  'sidecar/missing': 'A required local component is not installed.',
  'ocr/failed': 'Text recognition did not finish.',
  'conversion/provider-unavailable': 'The local conversion component is not available.',
  'print/failed': 'Printing did not finish.',
  'op/cancelled': 'The operation was cancelled.',
  'ipc/unknown-channel': 'An internal request used an unknown channel.',
  'ipc/untrusted-sender': 'An internal request came from an untrusted source.',
  'ipc/invalid-request': 'An internal request was rejected as invalid.',
  'ipc/invalid-response': 'An internal response was rejected as invalid.',
  'settings/invalid': 'Saved settings were unreadable and defaults were restored.',
  'internal/unexpected': 'Something went wrong.',
};

export const serializedAppErrorSchema = z.object({
  code: z.enum(appErrorCodes),
  message: z.string().min(1),
  details: z.string().optional(),
});

export type SerializedAppError = z.infer<typeof serializedAppErrorSchema>;

export interface AppErrorOptions {
  /** Overrides the default user-facing message for the code. */
  message?: string;
  /** Diagnostic text shown behind a "Details" expander. Never user-critical. */
  details?: string;
  cause?: unknown;
}

/** Typed, serializable error used across process boundaries. */
export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly details: string | undefined;

  constructor(code: AppErrorCode, options: AppErrorOptions = {}) {
    super(options.message ?? defaultMessages[code], { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.details = options.details;
  }

  toSerialized(): SerializedAppError {
    return this.details === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, details: this.details };
  }

  static isAppError(value: unknown): value is AppError {
    return value instanceof AppError;
  }

  static fromSerialized(value: SerializedAppError): AppError {
    return new AppError(value.code, {
      message: value.message,
      ...(value.details === undefined ? {} : { details: value.details }),
    });
  }

  /** Normalizes any thrown value into a serializable error payload. */
  static serialize(value: unknown): SerializedAppError {
    if (AppError.isAppError(value)) return value.toSerialized();
    if (value instanceof Error) {
      return {
        code: 'internal/unexpected',
        message: defaultMessages['internal/unexpected'],
        details: `${value.name}: ${value.message}`,
      };
    }
    return {
      code: 'internal/unexpected',
      message: defaultMessages['internal/unexpected'],
      details: typeof value === 'string' ? value : 'Unknown failure.',
    };
  }
}

export function defaultMessageForCode(code: AppErrorCode): string {
  return defaultMessages[code];
}
