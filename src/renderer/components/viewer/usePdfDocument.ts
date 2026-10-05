import { useCallback, useEffect, useRef, useState } from 'react';
import { AppError, type SerializedAppError } from '@shared/errors/appError';
import { documentUrlForSession } from '@shared/constants/app';
import type { LoadedPdfDocument } from '@pdf/render/types';
import { renderEngine } from './renderEngine';

export type PdfLoadStatus = 'loading' | 'password' | 'ready' | 'error';

interface LoadState {
  status: PdfLoadStatus;
  document: LoadedPdfDocument | null;
  /** The revision `document` was loaded from. */
  revision: number;
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
  revision: 0,
  error: null,
  passwordRetry: false,
};

/**
 * Loads the PDF behind an open session and keeps it alive while the tab is
 * shown. Bytes come from the `pfdoc` scheme, so the renderer works from a
 * session id and never sees a filesystem path.
 *
 * A change to the document arrives as a new revision, which is a different URL
 * and therefore a fresh load of what the main process has written. The
 * revision on screen stays ready while the next one loads — the pages keep
 * their pictures until new ones are drawn — so an edit never flashes the
 * workspace back to a loading state. Only a different document, or a retry,
 * starts again from nothing.
 */
export function usePdfDocument(sessionId: string | null, revision = 0): PdfDocumentState {
  const [state, setState] = useState<LoadState>(INITIAL);
  const [attempt, setAttempt] = useState(0);
  const [loadedFor, setLoadedFor] = useState({ sessionId, attempt });
  const passwordResolver = useRef<((password: string | null) => void) | null>(null);
  /** The document in `state`, which this hook owns until it is replaced. */
  const held = useRef<{ document: LoadedPdfDocument; sessionId: string; attempt: number } | null>(
    null,
  );
  /** Documents replaced on screen, destroyed once the replacement is committed. */
  const retired = useRef<LoadedPdfDocument[]>([]);

  // Reset while rendering rather than in an effect, so a tab switch never
  // shows the previous document for a frame.
  if (loadedFor.sessionId !== sessionId || loadedFor.attempt !== attempt) {
    setLoadedFor({ sessionId, attempt });
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

  /** Hands the document on screen over to be destroyed, if there is one. */
  const retireHeld = useCallback(() => {
    if (held.current !== null) retired.current.push(held.current.document);
    held.current = null;
  }, []);

  useEffect(() => {
    // A different document, or a retry, does not keep the old one on screen.
    if (
      held.current !== null &&
      (held.current.sessionId !== sessionId || held.current.attempt !== attempt)
    ) {
      retireHeld();
    }
    if (sessionId === null) return;

    const controller = new AbortController();
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
        if (disposed) {
          void result.destroy();
          return;
        }
        retireHeld();
        held.current = { document: result, sessionId, attempt };
        setState({
          status: 'ready',
          document: result,
          revision,
          error: null,
          passwordRetry: false,
        });
      })
      .catch((cause: unknown) => {
        if (disposed) return;
        retireHeld();
        setState({
          status: 'error',
          document: null,
          revision,
          error: AppError.serialize(cause),
          passwordRetry: false,
        });
      });

    return () => {
      disposed = true;
      passwordResolver.current?.(null);
      passwordResolver.current = null;
      controller.abort();
    };
  }, [sessionId, attempt, revision, retireHeld]);

  // A replaced document is destroyed only once its replacement is on screen:
  // destroying it sooner would fail the renders still drawing from it, and
  // the pages would flash an error before switching over.
  useEffect(() => {
    const stale = retired.current.filter((document) => document !== state.document);
    retired.current = retired.current.filter((document) => document === state.document);
    for (const document of stale) void document.destroy();
  }, [state.document]);

  // And everything goes when the workspace does.
  useEffect(
    () => () => {
      retireHeld();
      for (const document of retired.current) void document.destroy();
      retired.current = [];
    },
    [retireHeld],
  );

  return { ...state, submitPassword, cancelPassword, reload };
}
