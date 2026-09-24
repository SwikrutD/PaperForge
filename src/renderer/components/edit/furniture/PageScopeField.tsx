import type { ReactElement } from 'react';
import { parsePageRange } from '@shared/utils/pageRange';
import type { PageScope } from './pageScope';
import styles from '../../overlays/dialogForm.module.css';

interface PageScopeFieldProps {
  /** Distinguishes the radio group from any other on the same dialog. */
  name: string;
  scope: PageScope;
  rangeText: string;
  pageCount: number;
  currentPage: number;
  onScope: (scope: PageScope) => void;
  onRangeText: (text: string) => void;
}

/**
 * Which pages a change applies to.
 *
 * The same question comes up for watermarks, backgrounds and headers, and the
 * answer is always the same three: the whole document, the page being read,
 * or a range the reader writes out.
 */
export function PageScopeField({
  name,
  scope,
  rangeText,
  pageCount,
  currentPage,
  onScope,
  onRangeText,
}: PageScopeFieldProps): ReactElement {
  const range = parsePageRange(rangeText, pageCount);

  return (
    <fieldset className={styles.group}>
      <legend className={styles.legend}>Apply to</legend>

      <label className={styles.choice}>
        <input type="radio" name={name} checked={scope === 'all'} onChange={() => onScope('all')} />
        <span className={styles.choiceText}>{`All ${String(pageCount)} pages`}</span>
      </label>

      <label className={styles.choice}>
        <input
          type="radio"
          name={name}
          checked={scope === 'current'}
          onChange={() => onScope('current')}
        />
        <span className={styles.choiceText}>{`This page (${String(currentPage)})`}</span>
      </label>

      <div className={styles.block}>
        <label className={styles.choice}>
          <input
            type="radio"
            name={name}
            checked={scope === 'range'}
            onChange={() => onScope('range')}
          />
          A page range
        </label>
        <div className={styles.blockBody}>
          <input
            type="text"
            className={styles.input}
            placeholder="1-4, 9"
            aria-label="Page range"
            value={rangeText}
            onFocus={() => onScope('range')}
            onChange={(event) => onRangeText(event.target.value)}
          />
          {scope === 'range' && range.kind === 'invalid' && (
            <p className={styles.problem}>{range.message}</p>
          )}
        </div>
      </div>
    </fieldset>
  );
}
