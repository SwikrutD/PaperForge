import type { ReactElement } from 'react';
import type { Difference, DifferenceKind, PagePair } from '@pdf/compare/model';
import { useCompareStore, visibleDifferences } from '../../stores/compareStore';
import { cx } from '../../utils/classNames';
import styles from './compare.module.css';

const KIND_LABELS: Record<DifferenceKind, string> = {
  textAdded: 'Text added',
  textRemoved: 'Text removed',
  textChanged: 'Text changed',
  visual: 'Picture or layout',
  pageAdded: 'Page added',
  pageRemoved: 'Page removed',
  pageSize: 'Page size',
};

/**
 * Every difference found, page pair by page pair, filtered by kind. Choosing
 * one goes to its pair and brings it into view on both pages.
 */
export function DifferencesPanel(): ReactElement {
  const differences = useCompareStore((state) => state.differences);
  const pairs = useCompareStore((state) => state.pairs);
  const filters = useCompareStore((state) => state.filters);
  const selectedId = useCompareStore((state) => state.selectedId);
  const status = useCompareStore((state) => state.status);
  const progress = useCompareStore((state) => state.progress);
  const store = useCompareStore.getState;

  const shown = visibleDifferences(differences, filters);
  const pairsWithChanges = new Set(shown.map((difference) => difference.pair)).size;

  return (
    <aside className={styles.differences} aria-label="Differences">
      <header className={styles.differencesHeader}>
        <h2 className={styles.differencesTitle}>Differences</h2>
        <p className={styles.summary} role="status">
          {summaryText(status, shown.length, pairsWithChanges, progress)}
        </p>
        <div className={styles.filters} role="group" aria-label="Show">
          <label className={styles.filter}>
            <input
              type="checkbox"
              checked={filters.text}
              onChange={(event) => store().setFilter('text', event.target.checked)}
            />
            Text
          </label>
          <label className={styles.filter}>
            <input
              type="checkbox"
              checked={filters.visual}
              onChange={(event) => store().setFilter('visual', event.target.checked)}
            />
            Pictures, layout and pages
          </label>
        </div>
      </header>

      <ol className={styles.differenceList} aria-label="Differences found">
        {shown.map((difference) => (
          <li key={difference.id}>
            <button
              type="button"
              className={cx(
                styles.differenceItem,
                difference.id === selectedId && styles.differenceSelected,
              )}
              aria-current={difference.id === selectedId ? 'true' : undefined}
              onClick={() => store().select(difference.id)}
            >
              <span className={cx(styles.kindBar, styles[difference.kind])} aria-hidden="true" />
              <span className={styles.differenceText}>
                <span className={styles.differenceSummary}>{difference.summary}</span>
                <span className={styles.differenceMeta}>
                  {`${KIND_LABELS[difference.kind]} · ${describePair(pairs, difference)}`}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ol>

      <p className={styles.caveat}>
        Differences are found by comparing the words each page gives and the pixels each page draws.
        They say what changed, not what it means.
      </p>
    </aside>
  );
}

function summaryText(
  status: string,
  count: number,
  pairs: number,
  progress: { done: number; total: number } | null,
): string {
  if (status === 'idle') return 'Choose two documents, then Compare.';
  if (status === 'running') {
    const where =
      progress === null ? '' : ` Page pair ${String(progress.done)} of ${String(progress.total)}.`;
    return `Comparing…${where}`;
  }
  if (status === 'failed') return 'The comparison could not be finished.';
  const prefix = status === 'cancelled' ? 'Stopped early. ' : '';
  if (count === 0) return `${prefix}No differences found.`;
  return `${prefix}${String(count)} difference${count === 1 ? '' : 's'} on ${String(pairs)} page pair${pairs === 1 ? '' : 's'}.`;
}

function describePair(pairs: readonly PagePair[], difference: Difference): string {
  const pair = pairs.find((candidate) => candidate.index === difference.pair);
  if (pair === undefined) return `Pair ${String(difference.pair)}`;
  if (pair.original === pair.revised && pair.original !== null) {
    return `Page ${String(pair.original)}`;
  }
  if (pair.original === null) return `Revised page ${String(pair.revised)}`;
  if (pair.revised === null) return `Original page ${String(pair.original)}`;
  return `Page ${String(pair.original)} → ${String(pair.revised)}`;
}
