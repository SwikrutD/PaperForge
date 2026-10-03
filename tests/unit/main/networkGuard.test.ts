import { describe, expect, it, vi } from 'vitest';
import { blockNetwork, isAllowedNetworkRequest } from '../../../src/main/security/hardening';
import type { Logger } from '../../../src/main/services/logging/logger';

const warn = vi.fn();
const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() };

type Listener = (
  details: { url: string },
  callback: (response: { cancel?: boolean }) => void,
) => void;

/** A session that records the request filter and listener it is given. */
function fakeSession(): {
  session: Electron.Session;
  filter: () => string[];
  decide: (url: string) => boolean;
} {
  let urls: string[] = [];
  let listener: Listener | undefined;
  const session = {
    webRequest: {
      onBeforeRequest: (filter: { urls: string[] }, handler: Listener) => {
        urls = filter.urls;
        listener = handler;
      },
    },
  } as unknown as Electron.Session;

  return {
    session,
    filter: () => urls,
    decide: (url) => {
      let cancelled = false;
      listener?.({ url }, (response) => {
        cancelled = response.cancel === true;
      });
      return !cancelled;
    },
  };
}

describe('network guard', () => {
  it('lets nothing out of a production build', () => {
    expect(isAllowedNetworkRequest('https://example.org/font.woff2', [])).toBe(false);
    expect(isAllowedNetworkRequest('http://localhost:5173/', [])).toBe(false);
  });

  it('lets the development build reach its own server and nothing else', () => {
    const dev = ['http://localhost:5173'];
    expect(isAllowedNetworkRequest('http://localhost:5173/src/main.tsx', dev)).toBe(true);
    expect(isAllowedNetworkRequest('ws://localhost:5173/', dev)).toBe(true);
    expect(isAllowedNetworkRequest('http://localhost:5174/', dev)).toBe(false);
    expect(isAllowedNetworkRequest('http://localhost.evil.example:5173/', dev)).toBe(false);
    expect(isAllowedNetworkRequest('not a url', dev)).toBe(false);
  });

  it('watches every scheme a request could leave by, and cancels what it sees', () => {
    const { session, filter, decide } = fakeSession();
    blockNetwork(session, [], logger);

    expect(filter()).toEqual(
      expect.arrayContaining(['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*']),
    );
    expect(decide('https://example.org/')).toBe(false);
    expect(warn).toHaveBeenCalledWith('Blocked a network request.', 'https://example.org');
  });
});
