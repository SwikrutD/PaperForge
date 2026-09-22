import { create } from 'zustand';
import type { SearchMatch, SearchOptions } from '@pdf/search/textSearch';
import { stepIndex } from '../components/search/searchNavigation';
import { useDocumentStore } from './documentStore';

/** Where a search looks. */
export type SearchScope = 'document' | 'allOpen';

/** A match, together with the document it was found in. */
export interface SearchHit extends SearchMatch {
  sessionId: string;
  /** Stable identity, for React keys and for "am I on this one?" checks. */
  id: string;
}

/** A document the search could not read, and why. */
export interface SkippedDocument {
  sessionId: string;
  displayName: string;
  reason: string;
}

export interface SearchResults {
  /** Identifies the query these results belong to; stale results are dropped. */
  runKey: string;
  status: 'idle' | 'searching' | 'done';
  hits: SearchHit[];
  /** Index into `hits`, or -1 when the reader is not on a match. */
  currentIndex: number;
  /** Pages searched so far in this run. */
  scanned: number;
  /** Pages this run knows it will search. */
  total: number;
  /** Pages that carried no text at all — what a scanned page looks like. */
  pagesWithoutText: number;
  skipped: SkippedDocument[];
  /** True when the search stopped collecting matches at its limit. */
  truncated: boolean;
  /** Why the page range could not be read, if it could not. */
  rangeError: string | null;
}

export const EMPTY_RESULTS: SearchResults = {
  runKey: '',
  status: 'idle',
  hits: [],
  currentIndex: -1,
  scanned: 0,
  total: 0,
  pagesWithoutText: 0,
  skipped: [],
  truncated: false,
  rangeError: null,
};

/** What a scan publishes; the store decides which match the reader is on. */
export type SearchProgress = Omit<SearchResults, 'currentIndex'>;

export interface SearchStore {
  /** True while the find bar is on screen. */
  open: boolean;
  /** Bumped whenever the reader asks for the find field, so it takes focus. */
  focusRequest: number;
  query: string;
  options: SearchOptions;
  /** Draw every match, not only the one the reader is on. */
  highlightAll: boolean;
  scope: SearchScope;
  /** Page range as typed; parsed against each document searched. */
  pageRangeText: string;
  /** True while the extra options row is expanded. */
  optionsExpanded: boolean;
  /** True while the results list is expanded. */
  resultsExpanded: boolean;
  results: SearchResults;

  openFind: (options?: { expandOptions?: boolean }) => void;
  closeFind: () => void;
  setQuery: (query: string) => void;
  setOptions: (options: Partial<SearchOptions>) => void;
  setHighlightAll: (highlightAll: boolean) => void;
  setScope: (scope: SearchScope) => void;
  setPageRangeText: (text: string) => void;
  setOptionsExpanded: (expanded: boolean) => void;
  setResultsExpanded: (expanded: boolean) => void;

  /** Called by the scan as it works through the pages. */
  publishProgress: (progress: SearchProgress, selectIfUnset?: number) => void;
  clearResults: () => void;
  /** Go to a match, switching documents if it is in another one. */
  selectMatch: (index: number) => void;
  nextMatch: () => void;
  previousMatch: () => void;
}

/**
 * What the reader is searching for, and what has been found.
 *
 * It lives outside the viewer so a command, a shortcut, the find bar and the
 * page highlights all act on the same search, and so the query survives
 * switching tabs.
 */
export const useSearchStore = create<SearchStore>((set, get) => ({
  open: false,
  focusRequest: 0,
  query: '',
  options: { caseSensitive: false, wholeWord: false },
  highlightAll: true,
  scope: 'document',
  pageRangeText: '',
  optionsExpanded: false,
  resultsExpanded: false,
  results: EMPTY_RESULTS,

  openFind: (options) =>
    set((state) => ({
      open: true,
      focusRequest: state.focusRequest + 1,
      optionsExpanded: options?.expandOptions === true ? true : state.optionsExpanded,
    })),
  closeFind: () => set({ open: false, results: EMPTY_RESULTS }),
  setQuery: (query) => set({ query }),
  setOptions: (options) => set((state) => ({ options: { ...state.options, ...options } })),
  setHighlightAll: (highlightAll) => set({ highlightAll }),
  setScope: (scope) => set({ scope }),
  setPageRangeText: (pageRangeText) => set({ pageRangeText }),
  setOptionsExpanded: (optionsExpanded) => set({ optionsExpanded }),
  setResultsExpanded: (resultsExpanded) => set({ resultsExpanded }),

  publishProgress: (progress, selectIfUnset) =>
    set((state) => {
      // Results from an earlier query never carry their position forward.
      const fresh = state.results.runKey !== progress.runKey;
      let currentIndex = fresh ? -1 : state.results.currentIndex;
      if (currentIndex < 0 && selectIfUnset !== undefined) currentIndex = selectIfUnset;
      if (currentIndex >= progress.hits.length) currentIndex = -1;
      return { results: { ...progress, currentIndex } };
    }),

  clearResults: () =>
    set((state) => (state.results === EMPTY_RESULTS ? state : { results: EMPTY_RESULTS })),

  selectMatch: (index) => {
    const { results } = get();
    const hit = results.hits[index];
    if (hit === undefined) return;
    set({ results: { ...results, currentIndex: index } });
    const documents = useDocumentStore.getState();
    if (documents.activeId !== hit.sessionId) documents.activate(hit.sessionId);
  },

  nextMatch: () => {
    const { results, selectMatch } = get();
    selectMatch(stepIndex(results.currentIndex, results.hits.length, 1));
  },

  previousMatch: () => {
    const { results, selectMatch } = get();
    selectMatch(stepIndex(results.currentIndex, results.hits.length, -1));
  },
}));

/** The match the reader is on, if any. */
export function currentMatch(results: SearchResults): SearchHit | null {
  return results.hits[results.currentIndex] ?? null;
}
