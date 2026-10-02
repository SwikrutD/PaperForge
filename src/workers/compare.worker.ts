import { diffPixels } from '../pdf/compare/pixelDiff';
import type { CompareWorkerRequest, CompareWorkerResponse } from '../pdf/compare/workerProtocol';

/**
 * Compares two pictures of a page off the window's main thread, so a long
 * comparison never stalls scrolling or typing. The pixels arrive and leave as
 * transferred buffers: nothing is copied on the way in or out.
 */
self.onmessage = (event: MessageEvent<CompareWorkerRequest>): void => {
  const request = event.data;
  let response: CompareWorkerResponse;
  const transfer: ArrayBuffer[] = [];

  try {
    const result = diffPixels({
      width: request.width,
      height: request.height,
      original: new Uint8ClampedArray(request.original),
      revised: new Uint8ClampedArray(request.revised),
      overlay: request.overlay,
    });
    const overlay = result.overlay === null ? null : (result.overlay.buffer as ArrayBuffer);
    if (overlay !== null) transfer.push(overlay);
    response = {
      id: request.id,
      ok: true,
      regions: result.regions,
      changedRatio: result.changedRatio,
      overlay,
    };
  } catch (error) {
    response = { id: request.id, ok: false, message: String(error) };
  }

  self.postMessage(response, { transfer });
};
