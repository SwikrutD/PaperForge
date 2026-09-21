import { z } from 'zod';
import { serializedAppErrorSchema, type SerializedAppError } from '../errors/appError';

/**
 * IPC never rejects. Handlers always resolve with this envelope so the renderer
 * receives typed errors instead of Electron's stringified exceptions.
 */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: SerializedAppError };

export const ipcFailureSchema = z.object({
  ok: z.literal(false),
  error: serializedAppErrorSchema,
});

export function ipcSuccessSchema<T extends z.ZodType>(
  data: T,
): z.ZodObject<{ ok: z.ZodLiteral<true>; data: T }> {
  return z.object({ ok: z.literal(true), data });
}

export function ok<T>(data: T): IpcResult<T> {
  return { ok: true, data };
}

export function fail(error: SerializedAppError): IpcResult<never> {
  return { ok: false, error };
}
