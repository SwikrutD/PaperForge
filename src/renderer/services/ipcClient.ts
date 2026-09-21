import { AppError } from '@shared/errors/appError';
import {
  eventContracts,
  invokeContracts,
  type EventChannel,
  type EventPayload,
  type InvokeChannel,
  type InvokeRequest,
  type InvokeResponse,
} from '@shared/ipc/contracts';
import { ipcFailureSchema, ipcSuccessSchema } from '@shared/ipc/result';

/**
 * Typed renderer-side IPC. Every response and every pushed event is validated
 * against the shared contract before it reaches application code, and failures
 * arrive as a typed AppError rather than an opaque string.
 */
export async function invoke<C extends InvokeChannel>(
  channel: C,
  payload?: InvokeRequest<C>,
): Promise<InvokeResponse<C>> {
  const raw = await window.paperforge.invoke(channel, payload);

  const failure = ipcFailureSchema.safeParse(raw);
  if (failure.success) throw AppError.fromSerialized(failure.data.error);

  const success = ipcSuccessSchema(invokeContracts[channel].response).safeParse(raw);
  if (!success.success) {
    throw new AppError('ipc/invalid-response', {
      details: `${channel}: ${success.error.issues.map((issue) => issue.message).join('; ')}`,
    });
  }

  // The schema used above is the channel's own response schema.
  return success.data.data as InvokeResponse<C>;
}

export function subscribe<C extends EventChannel>(
  channel: C,
  listener: (payload: EventPayload<C>) => void,
): () => void {
  return window.paperforge.subscribe(channel, (raw) => {
    const parsed = eventContracts[channel].safeParse(raw);
    if (!parsed.success) {
      console.error(`PaperForge: ignored an invalid ${channel} event payload.`);
      return;
    }
    listener(parsed.data as EventPayload<C>);
  });
}
