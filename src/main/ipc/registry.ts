import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { AppError } from '@shared/errors/appError';
import {
  invokeContracts,
  type InvokeChannel,
  type InvokeInput,
  type InvokeResponse,
} from '@shared/ipc/contracts';
import { fail, ok, type IpcResult } from '@shared/ipc/result';
import type { Logger } from '../services/logging/logger';

export type InvokeHandler<C extends InvokeChannel> = (
  input: InvokeInput<C>,
  event: IpcMainInvokeEvent,
) => Promise<InvokeResponse<C>> | InvokeResponse<C>;

export interface IpcRegistrarOptions {
  /** Origins allowed to talk to the main process. */
  trustedOrigins: readonly string[];
  logger: Logger;
}

/** True when the request came from a frame PaperForge itself loaded. */
export function isTrustedSender(
  event: IpcMainInvokeEvent,
  trustedOrigins: readonly string[],
): boolean {
  const url = event.senderFrame?.url ?? '';
  return trustedOrigins.some((origin) => url === origin || url.startsWith(`${origin}/`));
}

/**
 * Registers a validated IPC handler.
 *
 * Requests are rejected unless they come from a trusted origin and match the
 * channel's schema. Responses are validated too, so a bug in the main process
 * surfaces as a typed error instead of corrupt renderer state. Handlers never
 * throw across the boundary: failures arrive as an IpcResult envelope.
 */
export function createIpcRegistrar({ trustedOrigins, logger }: IpcRegistrarOptions) {
  return function registerInvoke<C extends InvokeChannel>(
    channel: C,
    handler: InvokeHandler<C>,
  ): void {
    const contract = invokeContracts[channel];

    ipcMain.handle(channel, async (event, rawPayload: unknown): Promise<IpcResult<unknown>> => {
      try {
        if (!isTrustedSender(event, trustedOrigins)) {
          throw new AppError('ipc/untrusted-sender', { details: `channel ${channel}` });
        }

        const request = contract.request.safeParse(rawPayload);
        if (!request.success) {
          throw new AppError('ipc/invalid-request', {
            details: `${channel}: ${request.error.issues.map((issue) => issue.message).join('; ')}`,
          });
        }

        const result = await handler(request.data as InvokeInput<C>, event);
        const response = contract.response.safeParse(result);
        if (!response.success) {
          throw new AppError('ipc/invalid-response', {
            details: `${channel}: ${response.error.issues.map((issue) => issue.message).join('; ')}`,
          });
        }

        return ok(response.data);
      } catch (error) {
        const serialized = AppError.serialize(error);
        if (serialized.code === 'internal/unexpected') {
          logger.error(`IPC handler failed: ${channel}`, error);
        } else {
          logger.warn(
            `IPC handler rejected: ${channel}`,
            serialized.code,
            serialized.details ?? '',
          );
        }
        return fail(serialized);
      }
    });
  };
}
