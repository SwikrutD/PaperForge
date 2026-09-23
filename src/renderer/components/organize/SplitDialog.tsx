import { useMemo, useState, type ReactElement } from 'react';
import type { SplitPart } from '@shared/schemas/pages';
import { formatPageRange, parsePageRange } from '@shared/utils/pageRange';
import { Button } from '../controls/Button';
import { Dialog } from '../overlays/Dialog';
import { partsAtBoundaries, partsEveryN } from './organizeSelection';
import type { OrganizeActions } from './useOrganizeActions';
import styles from './organizeDialogs.module.css';

/** A top-level bookmark, as a place a piece can begin. */
export interface SplitBoundary {
  title: string;
  pageNumber: number;
}

interface SplitDialogProps {
  actions: OrganizeActions;
  pageCount: number;
  baseName: string;
  /** Top-level bookmarks of the document, empty when it has none. */
  boundaries: readonly SplitBoundary[];
  onClose: () => void;
}

type SplitMode = 'everyN' | 'ranges' | 'bookmarks';

/**
 * Split: writes this document out as several new documents.
 *
 * The pieces are listed before anything is written, so what will land in the
 * folder is visible first. This document itself is never changed.
 */
export function SplitDialog({
  actions,
  pageCount,
  baseName,
  boundaries,
  onClose,
}: SplitDialogProps): ReactElement {
  const [mode, setMode] = useState<SplitMode>('everyN');
  const [size, setSize] = useState(1);
  const [rangeText, setRangeText] = useState('');

  const plan = useMemo(
    () => buildPlan({ mode, size, rangeText, pageCount, baseName, boundaries }),
    [mode, size, rangeText, pageCount, baseName, boundaries],
  );

  const run = (): void => {
    actions.split(plan.parts);
    onClose();
  };

  return (
    <Dialog
      title="Split Document"
      description="Writes new documents into a folder you choose. This document is left as it is."
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button appearance="primary" onClick={run} disabled={plan.parts.length === 0}>
            {plan.parts.length <= 1 ? 'Split…' : `Write ${String(plan.parts.length)} documents…`}
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <fieldset className={styles.group}>
          <legend className={styles.legend}>Split by</legend>

          <div className={styles.block}>
            <label className={styles.choice}>
              <input
                type="radio"
                name="split-mode"
                checked={mode === 'everyN'}
                onChange={() => setMode('everyN')}
              />
              A number of pages
            </label>
            <div className={styles.blockRow}>
              <input
                type="number"
                className={`${styles.input} ${styles.number}`}
                min={1}
                max={Math.max(1, pageCount)}
                value={size}
                aria-label="Pages in each document"
                onChange={(event) => {
                  setMode('everyN');
                  setSize(Math.max(1, Math.trunc(Number(event.target.value) || 1)));
                }}
              />
              <span className={styles.hint}>pages in each document</span>
            </div>
          </div>

          <div className={styles.block}>
            <label className={styles.choice}>
              <input
                type="radio"
                name="split-mode"
                checked={mode === 'ranges'}
                onChange={() => setMode('ranges')}
              />
              Page ranges
            </label>
            <div className={styles.blockBody}>
              <input
                type="text"
                className={styles.input}
                placeholder="1-4, 5-9, 10-"
                value={rangeText}
                aria-label="Page ranges, one document each"
                onChange={(event) => {
                  setMode('ranges');
                  setRangeText(event.target.value);
                }}
              />
              <span className={styles.hint}>Each range becomes one document.</span>
            </div>
          </div>

          <label className={styles.choice}>
            <input
              type="radio"
              name="split-mode"
              checked={mode === 'bookmarks'}
              disabled={boundaries.length === 0}
              onChange={() => setMode('bookmarks')}
            />
            <span className={styles.choiceText}>
              Top-level bookmarks
              <span className={styles.hint}>
                {boundaries.length === 0
                  ? 'This document has no bookmarks that point at a page.'
                  : `${String(boundaries.length)} bookmark${boundaries.length === 1 ? '' : 's'}; each starts a new document.`}
              </span>
            </span>
          </label>
        </fieldset>

        {plan.problem !== null && <p className={styles.problem}>{plan.problem}</p>}

        {plan.parts.length > 0 && (
          <ul className={styles.preview} aria-label="Documents to be written">
            {plan.parts.slice(0, 40).map((part) => (
              <li className={styles.previewItem} key={part.name}>
                <span>{part.name}</span>
                <span className={styles.previewPages}>{formatPageRange(part.pages)}</span>
              </li>
            ))}
            {plan.parts.length > 40 && (
              <li className={styles.previewItem}>
                <span>{`… and ${String(plan.parts.length - 40)} more`}</span>
              </li>
            )}
          </ul>
        )}
      </div>
    </Dialog>
  );
}

interface PlanInput {
  mode: SplitMode;
  size: number;
  rangeText: string;
  pageCount: number;
  baseName: string;
  boundaries: readonly SplitBoundary[];
}

/** The pieces a split would produce, or why it cannot be worked out yet. */
function buildPlan(input: PlanInput): { parts: SplitPart[]; problem: string | null } {
  const { mode, pageCount, baseName } = input;

  if (mode === 'everyN') {
    const groups = partsEveryN(pageCount, input.size);
    return { parts: groups.map((pages) => named(baseName, pages)), problem: null };
  }

  if (mode === 'ranges') {
    if (input.rangeText.trim() === '') {
      return { parts: [], problem: 'Enter the page ranges, separated by commas.' };
    }
    const parts: SplitPart[] = [];
    for (const piece of input.rangeText.split(',')) {
      if (piece.trim() === '') continue;
      const range = parsePageRange(piece, pageCount);
      if (range.kind === 'invalid') return { parts: [], problem: range.message };
      const pages = range.kind === 'all' ? [] : range.pages;
      if (pages.length > 0) parts.push(named(baseName, pages));
    }
    return parts.length === 0
      ? { parts: [], problem: 'Those ranges do not name any page.' }
      : { parts, problem: null };
  }

  const groups = partsAtBoundaries(
    pageCount,
    input.boundaries.map((boundary) => boundary.pageNumber),
  );
  const titles = titlesFor(input.boundaries, groups);
  return {
    parts: groups.map((pages, index) => ({
      name: `${baseName} ${titles[index] ?? formatPageRange(pages)}.pdf`,
      pages,
    })),
    problem: null,
  };
}

function named(baseName: string, pages: readonly number[]): SplitPart {
  return { name: `${baseName} ${formatPageRange(pages)}.pdf`, pages: [...pages] };
}

/**
 * The bookmark each piece belongs to.
 *
 * A document whose first bookmark is not on page 1 gets an extra first piece,
 * which has no bookmark of its own and is named by its pages instead.
 */
function titlesFor(
  boundaries: readonly SplitBoundary[],
  groups: readonly number[][],
): Array<string | undefined> {
  return groups.map((pages) => {
    const first = pages[0];
    return boundaries.find((boundary) => boundary.pageNumber === first)?.title;
  });
}
