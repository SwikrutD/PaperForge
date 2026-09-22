import { useCallback, useEffect, useRef, useState } from 'react';
import { AppError, type SerializedAppError } from '@shared/errors/appError';
import { documentUrlForSession } from '@shared/constants/app';
import type { LoadedPdfDocument } from '@pdf/render/types';
import { renderEngine } from './renderEngine';

export type PdfLoadStatus = 'loading' | 'password' | 'ready' | 'error';

interface LoadState {
  status: PdfLoadStatus;
  document: LoadedPdfDocument | null;
  error: SerializedAppError | null;
  /** True when the last password attempt was rejected. */
  passwordRetry: boolean;
}

export interface PdfDocumentState extends LoadState {
  submitPassword: (password: string) => void;
  cancelPassword: () => void;
  reload: () => void;
}

const INITIAL: LoadState = {
  status: 'loading',
  document: null,
  error: null,
  passwordRetry: false,
};

/**
 * Loads the PDF behind an open session and keeps it alive while the tab is
 * shown. Bytes come from the `pfdoc` scheme, so the renderer works from a
 * session id and never sees a filesystem path.
 *
 * A change to the document arrives as a new revision, which is a different URL
 * and therefore a fresh load of what the main process has written.
 */
export function usePdfDocument(sessionId: string | null, revision = 0): PdfDocumentState {
  const [state, setState] = useState<LoadState>(INITIAL);
  const [attempt, setAttempt] = useState(0);
  const [loadedFor, setLoadedFor] = useState({ sessionId, attempt, revision });
  const passwordResolver = useRef<((password: string | null) => void) | null>(null);

  // Reset while rendering rather than in an effect, so a tab switch never
  // shows the previous document for a frame.
  if (
    loadedFor.sessionId !== sessionId ||
    loadedFor.attempt !== attempt ||
    loadedFor.revision !== revision
  ) {
    setLoadedFor({ sessionId, attempt, revision });
    setState(INITIAL);
  }

  const submitPassword = useCallback((password: string) => {
    const resolve = passwordResolver.current;
    passwordResolver.current = null;
    setState((current) => ({ ...current, status: 'loading' }));
    resolve?.(password);
  }, []);

  const cancelPassword = useCallback(() => {
    const resolve = passwordResolver.current;
    passwordResolver.current = null;
    resolve?.(null);
  }, []);

  const reload = useCallback(() => {
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    if (sessionId === null) return;

    const controller = new AbortController();
    let loaded: LoadedPdfDocument | null = null;
    let disposed = false;

    void renderEngine
      .load({
        url: documentUrlForSession(sessionId, revision),
        signal: controller.signal,
        requestPassword: (retry) =>
          new Promise<string | null>((resolve) => {
            passwordResolver.current = resolve;
            setState((current) => ({ ...current, status: 'password', passwordRetry: retry }));
          }),
      })
      .then((result) => {
        loaded = result;
        if (disposed) {
          void result.destroy();
          return;
        }
        setState({ status: 'ready', document: result, error: null, passwordRetry: false });
      })
      .catch((cause: unknown) => {
        if (disposed) return;
        setState({
          status: 'error',
          document: null,
          error: AppError.serialize(cause),
          passwordRetry: false,
        });
      });

    return () => {
      disposed = true;
      passwordResolver.current?.(null);
      passwordResolver.current = null;
      controller.abort();
      void loaded?.destroy();
    };
  }, [sessionId, attempt, revision]);

  return { ...state, submitPassword, cancelPassword, reload };
}
