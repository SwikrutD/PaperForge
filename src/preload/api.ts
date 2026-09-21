import { ipcRenderer, type IpcRendererEvent } from 'electron';
import { isEventChannel, isInvokeChannel } from '@shared/ipc/channelNames';
import type { PaperForgeBridge } from '@shared/types/bridge';

/**
 * The preload bridge. It forwards allowlisted channels and nothing else — no
 * Node APIs, no filesystem, no child processes, no dynamic channel names.
 * Schema validation lives in the main process (requests) and the renderer
 * (responses and events), which keeps this bundle free of dependencies.
 */
export function createBridge(): PaperForgeBridge {
  return {
    async invoke(channel, payload) {
      if (!isInvokeChannel(channel)) {
        throw new Error(`PaperForge: refused an unknown IPC channel "${String(channel)}".`);
      }
      return (await ipcRenderer.invoke(channel, payload)) as unknown;
    },

    subscribe(channel, listener) {
      if (!isEventChannel(channel)) {
        throw new Error(`PaperForge: refused an unknown event channel "${String(channel)}".`);
      }
      const handler = (_event: IpcRendererEvent, payload: unknown): void => {
        listener(payload);
      };
      ipcRenderer.on(channel, handler);
      return () => {
        ipcRenderer.removeListener(channel, handler);
      };
    },
  };
}
