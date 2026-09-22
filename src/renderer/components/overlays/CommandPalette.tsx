import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Search } from 'lucide-react';
import { useCommands } from '../../commands/useCommands';
import { formatShortcut } from '../../keyboard/shortcuts';
import { useUiStore } from '../../stores/uiStore';
import { cx } from '../../utils/classNames';
import { filterCommands } from '../../commands/filterCommands';
import type { ResolvedCommand } from '../../commands/types';
import styles from './CommandPalette.module.css';

/**
 * Ctrl+K search over every command. Disabled commands stay listed with their
 * reason, so the palette explains rather than hides.
 */
export function CommandPalette(): ReactElement {
  const { resolveAll, execute } = useCommands();
  const close = useUiStore((state) => state.setCommandPaletteOpen);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const results = useMemo(() => filterCommands(resolveAll(), query), [resolveAll, query]);
  const clampedIndex = results.length === 0 ? 0 : Math.min(activeIndex, results.length - 1);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    // scrollIntoView is missing in some test environments.
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${clampedIndex}"]`)
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [clampedIndex]);

  const run = (entry: ResolvedCommand | undefined): void => {
    if (entry === undefined || !entry.enabled) return;
    close(false);
    execute(entry.definition.id);
  };

  return (
    <div
      className={styles.backdrop}
      onMouseDown={(event) => event.target === event.currentTarget && close(false)}
    >
      <div className={styles.surface} role="dialog" aria-modal="true" aria-label="Command palette">
        <div className={styles.searchRow}>
          <Search className={styles.searchIcon} aria-hidden="true" strokeWidth={1.75} />
          <input
            ref={inputRef}
            className={styles.input}
            type="text"
            role="combobox"
            aria-expanded
            aria-controls="pf-palette-results"
            aria-activedescendant={results.length > 0 ? `pf-palette-${clampedIndex}` : undefined}
            placeholder="Search commands"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActiveIndex((index) =>
                  results.length === 0 ? 0 : (index + 1) % results.length,
                );
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActiveIndex((index) =>
                  results.length === 0 ? 0 : (index - 1 + results.length) % results.length,
                );
              } else if (event.key === 'Enter') {
                event.preventDefault();
                run(results[clampedIndex]);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                close(false);
              }
            }}
          />
        </div>

        <ul className={styles.results} id="pf-palette-results" role="listbox" ref={listRef}>
          {results.length === 0 && <li className={styles.empty}>No matching commands.</li>}
          {results.map((entry, index) => (
            <li
              key={entry.definition.id}
              id={`pf-palette-${index}`}
              data-index={index}
              role="option"
              aria-selected={index === clampedIndex}
              aria-disabled={!entry.enabled}
              className={cx(
                styles.result,
                index === clampedIndex && styles.active,
                !entry.enabled && styles.disabled,
              )}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => run(entry)}
            >
              <span className={styles.resultText}>
                <span className={styles.resultTitle}>{entry.definition.title}</span>
                <span className={styles.resultDescription}>
                  {entry.enabled
                    ? (entry.definition.description ?? '')
                    : (entry.reason ?? 'Not available right now.')}
                </span>
              </span>
              {entry.checked && <span className={styles.badge}>On</span>}
              {entry.definition.shortcut !== undefined && (
                <span className={styles.chord}>{formatShortcut(entry.definition.shortcut)}</span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
