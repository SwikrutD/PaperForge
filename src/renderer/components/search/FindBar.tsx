import { useEffect, useRef, type KeyboardEvent, type ReactElement } from 'react';
import {
  CaseSensitive,
  ChevronDown,
  ChevronUp,
  Highlighter,
  ListOrdered,
  Search,
  SlidersHorizontal,
  WholeWord,
  X,
} from 'lucide-react';
import { IconButton } from '../controls/IconButton';
import { useDocumentStore } from '../../stores/documentStore';
import { useSearchStore } from '../../stores/searchStore';
import { SearchResults } from './SearchResults';
import styles from './FindBar.module.css';

/**
 * The find bar: one row for the query, an optional row for scope and page
 * range, and an optional list of results. It reports what the search actually
 * found, including pages that carry no text at all.
 */
export function FindBar(): ReactElement {
  const store = useSearchStore();
  const openDocumentCount = useDocumentStore((state) => state.tabs.length);
  const results = store.results;
  const inputRef = useRef<HTMLInputElement>(null);

  // Ctrl+F while the bar is already open selects what is in the field, so the
  // reader can type over it.
  useEffect(() => {
    const input = inputRef.current;
    if (input === null) return;
    input.focus();
    input.select();
  }, [store.focusRequest]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      store.closeFind();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (event.shiftKey) store.previousMatch();
      else store.nextMatch();
    }
  };

  const hasQuery = store.query.trim() !== '';
  const matchCount = results.hits.length;
  const position = results.currentIndex >= 0 ? results.currentIndex + 1 : 0;

  return (
    <section className={styles.bar} aria-label="Find in document">
      <div className={styles.row}>
        <div className={styles.field}>
          <Search className={styles.fieldIcon} aria-hidden="true" strokeWidth={1.75} />
          <input
            ref={inputRef}
            className={styles.input}
            type="search"
            value={store.query}
            placeholder="Find in document"
            aria-label="Find in document"
            spellCheck={false}
            onChange={(event) => store.setQuery(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <span className={styles.count} aria-live="polite">
            {describeCount(results.status, hasQuery, position, matchCount, results.truncated)}
          </span>
        </div>

        <IconButton
          icon={ChevronUp}
          label="Previous match"
          tooltip="Previous match (Shift+F3)"
          size="small"
          disabled={matchCount === 0}
          disabledReason="No matches to step through."
          onClick={store.previousMatch}
        />
        <IconButton
          icon={ChevronDown}
          label="Next match"
          tooltip="Next match (F3)"
          size="small"
          disabled={matchCount === 0}
          disabledReason="No matches to step through."
          onClick={store.nextMatch}
        />

        <span className={styles.divider} aria-hidden="true" />

        <IconButton
          icon={CaseSensitive}
          label="Match case"
          size="small"
          pressed={store.options.caseSensitive}
          onClick={() => store.setOptions({ caseSensitive: !store.options.caseSensitive })}
        />
        <IconButton
          icon={WholeWord}
          label="Whole words only"
          size="small"
          pressed={store.options.wholeWord}
          onClick={() => store.setOptions({ wholeWord: !store.options.wholeWord })}
        />
        <IconButton
          icon={Highlighter}
          label="Highlight all matches"
          size="small"
          pressed={store.highlightAll}
          onClick={() => store.setHighlightAll(!store.highlightAll)}
        />
        <IconButton
          icon={ListOrdered}
          label="Show results"
          size="small"
          pressed={store.resultsExpanded}
          disabled={matchCount === 0}
          disabledReason="No matches to list."
          onClick={() => store.setResultsExpanded(!store.resultsExpanded)}
        />
        <IconButton
          icon={SlidersHorizontal}
          label="Search options"
          tooltip="Search options (Ctrl+H)"
          size="small"
          pressed={store.optionsExpanded}
          onClick={() => store.setOptionsExpanded(!store.optionsExpanded)}
        />

        <span className={styles.divider} aria-hidden="true" />

        <IconButton
          icon={X}
          label="Close find"
          tooltip="Close find (Esc)"
          size="small"
          onClick={store.closeFind}
        />
      </div>

      {store.optionsExpanded && (
        <div className={styles.options}>
          <div className={styles.scope} role="group" aria-label="Search in">
            <button
              type="button"
              className={styles.scopeButton}
              aria-pressed={store.scope === 'document'}
              onClick={() => store.setScope('document')}
            >
              This document
            </button>
            <button
              type="button"
              className={styles.scopeButton}
              aria-pressed={store.scope === 'allOpen'}
              disabled={openDocumentCount < 2}
              title={
                openDocumentCount < 2
                  ? 'Only one document is open.'
                  : `Search all ${openDocumentCount} open documents.`
              }
              onClick={() => store.setScope('allOpen')}
            >
              All open documents
            </button>
          </div>

          <label className={styles.range}>
            <span className={styles.rangeLabel}>Pages</span>
            <input
              className={styles.rangeInput}
              type="text"
              value={store.pageRangeText}
              placeholder="All"
              aria-label="Pages to search, for example 1-5, 8"
              aria-invalid={results.rangeError !== null}
              spellCheck={false}
              onChange={(event) => store.setPageRangeText(event.target.value)}
            />
          </label>

          {results.rangeError !== null && (
            <p className={styles.error} role="alert">
              {results.rangeError}
            </p>
          )}
        </div>
      )}

      <FindStatus />

      {store.resultsExpanded && matchCount > 0 && <SearchResults />}
    </section>
  );
}

/** Everything worth saying about the run that just happened, and nothing more. */
function FindStatus(): ReactElement | null {
  const results = useSearchStore((state) => state.results);
  const query = useSearchStore((state) => state.query);
  const noText = results.scanned > 0 && results.pagesWithoutText === results.scanned;

  const notes: string[] = [];
  if (results.status === 'done' && results.hits.length === 0 && query.trim() !== '') {
    notes.push(
      noText
        ? 'These pages carry no text, so there is nothing to search. They are most likely scanned images.'
        : 'No matches.',
    );
  }
  if (results.hits.length > 0 && results.pagesWithoutText > 0) {
    notes.push(
      `${results.pagesWithoutText} ${results.pagesWithoutText === 1 ? 'page carries' : 'pages carry'} no text and could not be searched.`,
    );
  }
  if (results.truncated) {
    notes.push('Stopped at 5,000 matches. Narrow the search to see the rest.');
  }
  for (const skipped of results.skipped) {
    notes.push(`${skipped.displayName} was not searched: ${skipped.reason}`);
  }

  if (notes.length === 0) return null;
  return (
    <div className={styles.status} role="status">
      {notes.map((note) => (
        <p key={note} className={styles.note}>
          {note}
        </p>
      ))}
    </div>
  );
}

function describeCount(
  status: 'idle' | 'searching' | 'done',
  hasQuery: boolean,
  position: number,
  count: number,
  truncated: boolean,
): string {
  if (!hasQuery) return '';
  if (count === 0) return status === 'searching' ? 'Searching…' : 'No matches';
  const total = `${count}${truncated ? '+' : ''}`;
  const progress = status === 'searching' ? '…' : '';
  return position === 0 ? `${total} matches${progress}` : `${position} of ${total}${progress}`;
}
