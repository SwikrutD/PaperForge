import { useEffect, useRef, type ReactElement } from 'react';
import { useDocumentStore } from '../../stores/documentStore';
import { cx } from '../../utils/classNames';
import { useSearchStore, type SearchHit } from '../../stores/searchStore';
import styles from './SearchResults.module.css';

/** Matches in document order, with enough text around each one to recognize it. */
export function SearchResults(): ReactElement {
  const results = useSearchStore((state) => state.results);
  const selectMatch = useSearchStore((state) => state.selectMatch);
  const tabs = useDocumentStore((state) => state.tabs);
  const listRef = useRef<HTMLUListElement>(null);

  const nameOf = (hit: SearchHit): string =>
    tabs.find((tab) => tab.session.id === hit.sessionId)?.session.file.displayName ?? 'Document';
  const multipleDocuments = new Set(results.hits.map((hit) => hit.sessionId)).size > 1;

  // Keep the match the reader is on in view as they step through.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[data-current="true"]')
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [results.currentIndex]);

  return (
    <ul className={styles.list} ref={listRef} aria-label="Search results">
      {results.hits.map((hit, index) => {
        const current = index === results.currentIndex;
        return (
          <li key={hit.id}>
            <button
              type="button"
              className={cx(styles.item, current && styles.current)}
              data-current={current ? 'true' : undefined}
              aria-current={current ? 'true' : undefined}
              onClick={() => selectMatch(index)}
            >
              <span className={styles.where}>
                {multipleDocuments
                  ? `${nameOf(hit)} · page ${hit.pageNumber}`
                  : `Page ${hit.pageNumber}`}
              </span>
              <span className={styles.excerpt}>{hit.excerpt}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
