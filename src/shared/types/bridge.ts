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
  /**
   * Resolves the path of a file the user dropped on the window. Chromium no
   * longer exposes File.path, and this is the only way the renderer can learn
   * one — it reveals nothing the user did not just hand over.
   */
  getPathForFile(file: File): string;
}
