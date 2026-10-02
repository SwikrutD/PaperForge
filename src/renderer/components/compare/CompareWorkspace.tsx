import { useMemo, useRef, type ReactElement, type UIEvent } from 'react';
import { ChevronLeft, ChevronRight, GitCompare } from 'lucide-react';
import { useCompareStore, visibleDifferences } from '../../stores/compareStore';
import { IconButton } from '../controls/IconButton';
import { ComparePane } from './ComparePane';
import { CompareToolbar } from './CompareToolbar';
import { DifferencesPanel } from './DifferencesPanel';
import { OverlayPane } from './OverlayPane';
import styles from './compare.module.css';

/**
 * Compare Files: two documents, page pair by page pair, side by side or
 * overlaid, with every difference listed beside them. Local only — the pages
 * are drawn and compared in this window and its worker.
 */
export function CompareWorkspace(): ReactElement {
  const pairs = useCompareStore((state) => state.pairs);
  const currentPair = useCompareStore((state) => state.currentPair);
  const differences = useCompareStore((state) => state.differences);
  const filters = useCompareStore((state) => state.filters);
  const mode = useCompareStore((state) => state.mode);
  const syncScroll = useCompareStore((state) => state.syncScroll);
  const status = useCompareStore((state) => state.status);
  const store = useCompareStore.getState;

  const originalRef = useRef<HTMLDivElement>(null);
  const revisedRef = useRef<HTMLDivElement>(null);
  /** The pane being scrolled by the other, so its echo is not passed back. */
  const following = useRef<HTMLDivElement | null>(null);

  const pair = pairs.find((candidate) => candidate.index === currentPair) ?? null;
  const onPair = useMemo(
    () =>
      visibleDifferences(differences, filters).filter(
        (difference) => difference.pair === currentPair,
      ),
    [differences, filters, currentPair],
  );

  // Scrolling together keeps the same share of each page in view, so pages of
  // different lengths stay level.
  const follow = (event: UIEvent<HTMLDivElement>): void => {
    if (!syncScroll) return;
    const source = event.currentTarget;
    if (following.current === source) {
      following.current = null;
      return;
    }
    const target = source === originalRef.current ? revisedRef.current : originalRef.current;
    if (target === null) return;
    const range = source.scrollHeight - source.clientHeight;
    const ratio = range <= 0 ? 0 : source.scrollTop / range;
    following.current = target;
    target.scrollTop = ratio * (target.scrollHeight - target.clientHeight);
  };

  return (
    <div className={styles.workspace} data-compare-workspace="">
      <CompareToolbar />
      <div className={styles.body}>
        <div className={styles.main}>
          {pair === null ? (
            <div className={styles.empty}>
              <GitCompare className={styles.emptyIcon} aria-hidden="true" strokeWidth={1.5} />
              <p className={styles.emptyTitle}>
                {status === 'running' ? 'Comparing…' : 'Compare two versions of a document'}
              </p>
              <p className={styles.emptyText}>
                Choose the original and the revised document above, then Compare. Pages are paired
                in order; set a page offset if the revision gained or lost pages at the front.
              </p>
            </div>
          ) : (
            <>
              <nav className={styles.pairBar} aria-label="Page pairs">
                <IconButton
                  icon={ChevronLeft}
                  label="Previous page pair"
                  size="small"
                  disabled={currentPair <= 1}
                  onClick={() => store().goToPair(currentPair - 1)}
                />
                <span className={styles.pairText} aria-live="polite">
                  {`Page pair ${String(currentPair)} of ${String(pairs.length)}`}
                </span>
                <IconButton
                  icon={ChevronRight}
                  label="Next page pair"
                  size="small"
                  disabled={currentPair >= pairs.length}
                  onClick={() => store().goToPair(currentPair + 1)}
                />
              </nav>
              {mode === 'sideBySide' ? (
                <div className={styles.panes}>
                  <ComparePane
                    ref={originalRef}
                    side="original"
                    pageNumber={pair.original}
                    differences={onPair}
                    onScroll={follow}
                  />
                  <ComparePane
                    ref={revisedRef}
                    side="revised"
                    pageNumber={pair.revised}
                    differences={onPair}
                    onScroll={follow}
                  />
                </div>
              ) : (
                <OverlayPane
                  pair={pair.index}
                  originalPage={pair.original}
                  revisedPage={pair.revised}
                  differences={onPair}
                />
              )}
            </>
          )}
        </div>
        <DifferencesPanel />
      </div>
    </div>
  );
}
