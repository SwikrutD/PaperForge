import { useEffect } from 'react';
import { documentUrlForSession } from '@shared/constants/app';
import { pagesInRange, parsePageRange } from '@shared/utils/pageRange';
import { AppError } from '@shared/errors/appError';
import { searchPage } from '@pdf/search/textSearch';
import type { LoadedPdfDocument } from '@pdf/render/types';
import { useDocumentStore } from '../../stores/documentStore';
import {
  useSearchStore,
  type SearchHit,
  type SearchProgress,
  type SkippedDocument,
} from '../../stores/searchStore';
import { usePdfDocumentContext } from '../viewer/pdfDocumentContextValue';
import { renderEngine } from '../viewer/renderEngine';
import { chooseInitialIndex } from './searchNavigation';

/** Typing should not start a scan per keystroke. */
const DEBOUNCE_MS = 180;
/** A one-letter query in a long document would otherwise never stop growing. */
const MAX_HITS = 5000;
/** Pages between progress updates, so the count moves without thrashing React. */
const PUBLISH_EVERY = 8;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Runs the reader's query over the open documents, a page at a time, and
 * publishes what it finds to the search store.
 *
 * Text is pulled from the engine page by page rather than all at once, so a
 * search in a long document reports its first matches immediately and can be
 * abandoned the moment the query changes. Everything is local: the text comes
 * from the PDF.js worker that already has the file open.
 */
export function useSearchScan(): void {
  const open = useSearchStore((state) => state.open);
  const query = useSearchStore((state) => state.query);
  const options = useSearchStore((state) => state.options);
  const scope = useSearchStore((state) => state.scope);
  const pageRangeText = useSearchStore((state) => state.pageRangeText);
  const publishProgress = useSearchStore((state) => state.publishProgress);
  const clearResults = useSearchStore((state) => state.clearResults);

  const { document: activeDocument } = usePdfDocumentContext();
  const activeId = useDocumentStore((state) => state.activeId);
  const sessionIds = useDocumentStore((state) =>
    state.tabs.map((tab) => tab.session.id).join('\u0000'),
  );

  const trimmedQuery = query.trim() === '' ? '' : query;
  const searchable = open && trimmedQuery !== '' && activeDocument !== null && activeId !== null;
  const runKey = searchable
    ? [
        trimmedQuery,
        String(options.caseSensitive),
        String(options.wholeWord),
        scope,
        pageRangeText,
        activeId,
        scope === 'allOpen' ? sessionIds : '',
      ].join('\u0001')
    : '';

  useEffect(() => {
    if (!searchable || activeDocument === null || activeId === null) {
      clearResults();
      return;
    }

    let cancelled = false;

    const run = async (): Promise<void> => {
      await wait(DEBOUNCE_MS);
      if (cancelled) return;

      const targets = useDocumentStore
        .getState()
        .tabs.filter((tab) => scope === 'allOpen' || tab.session.id === activeId)
        .map((tab) => tab.session);

      const hits: SearchHit[] = [];
      const skipped: SkippedDocument[] = [];
      let scanned = 0;
      // Pages are counted as documents are opened, so a search across several
      // documents reports the pages it knows about rather than guessing.
      let total = 0;
      let pagesWithoutText = 0;
      let truncated = false;

      const publish = (status: 'searching' | 'done', rangeError: string | null = null): void => {
        const progress: SearchProgress = {
          runKey,
          status,
          hits: [...hits],
          scanned,
          total,
          pagesWithoutText,
          skipped: [...skipped],
          truncated,
          rangeError,
        };
        const page = useDocumentStore.getState().tabs.find((tab) => tab.session.id === activeId)
          ?.view.pageNumber;
        publishProgress(progress, chooseInitialIndex(hits, activeId, page ?? 1));
      };

      // A typo in the page range is reported before anything is searched.
      const activeRange = parsePageRange(pageRangeText, activeDocument.pages.length);
      if (activeRange.kind === 'invalid') {
        publish('done', activeRange.message);
        return;
      }

      publish('searching');

      for (const session of targets) {
        if (cancelled || truncated) break;

        // The document in front of the reader is already open; the others are
        // opened for the search and released again.
        const borrowed = session.id === activeId;
        let document: LoadedPdfDocument;
        if (borrowed) {
          document = activeDocument;
        } else {
          try {
            document = await renderEngine.load({ url: documentUrlForSession(session.id) });
          } catch (cause) {
            if (cancelled) return;
            skipped.push({
              sessionId: session.id,
              displayName: session.file.displayName,
              reason: AppError.serialize(cause).message,
            });
            publish('searching');
            continue;
          }
        }

        try {
          const range = parsePageRange(pageRangeText, document.pages.length);
          if (range.kind === 'invalid') {
            skipped.push({
              sessionId: session.id,
              displayName: session.file.displayName,
              reason: range.message,
            });
            publish('searching');
            continue;
          }

          const pages = pagesInRange(range, document.pages.length);
          total += pages.length;

          for (const pageNumber of pages) {
            if (cancelled || truncated) break;
            const pageText = await document.getPageText(pageNumber).catch(() => null);
            if (cancelled) return;

            scanned += 1;
            if (pageText === null || pageText.text.trim() === '') {
              pagesWithoutText += 1;
            } else {
              for (const match of searchPage(pageText, trimmedQuery, options)) {
                if (hits.length >= MAX_HITS) {
                  truncated = true;
                  break;
                }
                hits.push({
                  ...match,
                  sessionId: session.id,
                  id: `${session.id}:${match.pageNumber}:${match.start}`,
                });
              }
            }

            if (scanned % PUBLISH_EVERY === 0) publish('searching');
          }
        } finally {
          if (!borrowed) await document.destroy();
        }
      }

      if (!cancelled) publish('done');
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [
    searchable,
    runKey,
    trimmedQuery,
    options,
    scope,
    pageRangeText,
    activeDocument,
    activeId,
    publishProgress,
    clearResults,
  ]);
}
