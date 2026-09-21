import type { EventChannel, InvokeChannel } from '../ipc/contracts';

/**
 * The entire surface exposed to the renderer by the preload script.
 *
 * It is intentionally narrow: a channel-allowlisted invoke, a channel-
 * allowlisted subscribe, and nothing else. No filesystem, no child processes,
 * no Node globals.
 *
 * Payloads cross the bridge untyped on purpose — the renderer's IPC client
 * validates them against the shared contracts before any code consumes them.
 */
export interface PaperForgeBridge {
  /** Resolves with an IpcResult envelope; never rejects for handled errors. */
  invoke(channel: InvokeChannel, payload?: unknown): Promise<unknown>;
  /** Subscribes to a main-process event. Returns an unsubscribe function. */
  subscribe(channel: EventChannel, listener: (payload: unknown) => void): () => void;
}
