import { describe, expect, it } from 'vitest';
import { AppError, serializedAppErrorSchema } from '../../../src/shared/errors/appError';

describe('AppError', () => {
  it('uses the default message for a code', () => {
    expect(new AppError('pdf/wrong-password').message).toBe('That password did not work.');
  });

  it('round-trips through serialization', () => {
    const original = new AppError('io/write-failed', { details: 'disk on fire' });
    const restored = AppError.fromSerialized(original.toSerialized());
    expect(restored.code).toBe('io/write-failed');
    expect(restored.details).toBe('disk on fire');
    expect(serializedAppErrorSchema.safeParse(original.toSerialized()).success).toBe(true);
  });

  it('omits details when there are none', () => {
    expect(new AppError('op/cancelled').toSerialized()).toEqual({
      code: 'op/cancelled',
      message: 'The operation was cancelled.',
    });
  });

  it('normalizes unknown throwables without leaking a stack trace', () => {
    const serialized = AppError.serialize(new TypeError('boom at /secret/path'));
    expect(serialized.code).toBe('internal/unexpected');
    expect(serialized.message).toBe('Something went wrong.');
    expect(serialized.details).toBe('TypeError: boom at /secret/path');
  });

  it('normalizes non-error values', () => {
    expect(AppError.serialize(42).details).toBe('Unknown failure.');
  });
});
