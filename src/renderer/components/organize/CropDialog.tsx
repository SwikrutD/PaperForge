import { useState, type ReactElement } from 'react';
import { formatPageRange, parsePageRange } from '@shared/utils/pageRange';
import { Button } from '../controls/Button';
import { Dialog } from '../overlays/Dialog';
import { boxesForPage, useOrganizeStore } from '../../stores/organizeStore';
import type { CropMargins, OrganizeActions } from './useOrganizeActions';
import styles from '../overlays/dialogForm.module.css';

interface CropDialogProps {
  actions: OrganizeActions;
  pageCount: number;
  onClose: () => void;
}

type Scope = 'chosen' | 'all' | 'range';

const EDGES = [
  { key: 'top', label: 'Top' },
  { key: 'bottom', label: 'Bottom' },
  { key: 'left', label: 'Left' },
  { key: 'right', label: 'Right' },
] as const;

/**
 * Crop: moves each edge of what the pages show inwards.
 *
 * Margins are used rather than one rectangle so that pages of different sizes
 * can be cropped together. The crop box only hides content and can be put
 * back; changing the page itself is a separate choice, and says so.
 */
export function CropDialog({ actions, pageCount, onClose }: CropDialogProps): ReactElement {
  const boxes = useOrganizeStore((state) => state.boxes);
  const [margins, setMargins] = useState<CropMargins>({ left: 0, bottom: 0, right: 0, top: 0 });
  const [scope, setScope] = useState<Scope>('chosen');
  const [rangeText, setRangeText] = useState('');
  const [resizePage, setResizePage] = useState(false);

  const range = parsePageRange(rangeText, pageCount);
  const pages =
    scope === 'chosen'
      ? actions.pages
      : scope === 'all'
        ? Array.from({ length: pageCount }, (_, index) => index + 1)
        : range.kind === 'pages'
          ? range.pages
          : [];

  const first = boxesForPage(boxes, pages[0] ?? 0);
  const showing = first?.crop ?? first?.media ?? null;
  const resulting =
    showing === null
      ? null
      : {
          width: Math.max(1, showing.width - margins.left - margins.right),
          height: Math.max(1, showing.height - margins.top - margins.bottom),
        };

  const problem =
    scope === 'range' && range.kind === 'invalid'
      ? range.message
      : pages.length === 0
        ? 'Choose the pages to crop.'
        : null;

  const apply = (): void => {
    actions.crop(pages, margins, resizePage ? 'media' : 'crop');
    onClose();
  };

  const reset = (): void => {
    actions.resetCrop(pages);
    onClose();
  };

  return (
    <Dialog
      title="Crop Pages"
      description="Measured in points, from what each page shows now. 72 points is one inch."
      onClose={onClose}
      footer={
        <>
          <Button onClick={reset} disabled={pages.length === 0}>
            Reset crop
          </Button>
          <Button onClick={onClose}>Cancel</Button>
          <Button appearance="primary" onClick={apply} disabled={problem !== null}>
            Apply
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <fieldset className={styles.group}>
          <legend className={styles.legend}>Margins</legend>
          {EDGES.map((edge) => (
            <div className={styles.row} key={edge.key}>
              <label className={styles.label} htmlFor={`crop-${edge.key}`}>
                {edge.label}
              </label>
              <input
                id={`crop-${edge.key}`}
                type="number"
                className={`${styles.input} ${styles.number}`}
                min={0}
                max={2000}
                step={1}
                value={margins[edge.key]}
                onChange={(event) =>
                  setMargins({
                    ...margins,
                    [edge.key]: Math.max(0, Number(event.target.value) || 0),
                  })
                }
              />
            </div>
          ))}
        </fieldset>

        <fieldset className={styles.group}>
          <legend className={styles.legend}>Apply to</legend>
          <label className={styles.choice}>
            <input
              type="radio"
              name="crop-scope"
              checked={scope === 'chosen'}
              onChange={() => setScope('chosen')}
            />
            <span className={styles.choiceText}>
              The chosen pages
              <span className={styles.hint}>
                {actions.pages.length === 0
                  ? 'No page is chosen.'
                  : `Page${actions.pages.length === 1 ? '' : 's'} ${formatPageRange(actions.pages)}.`}
              </span>
            </span>
          </label>
          <label className={styles.choice}>
            <input
              type="radio"
              name="crop-scope"
              checked={scope === 'all'}
              onChange={() => setScope('all')}
            />
            <span className={styles.choiceText}>{`All ${String(pageCount)} pages`}</span>
          </label>
          <div className={styles.block}>
            <label className={styles.choice}>
              <input
                type="radio"
                name="crop-scope"
                checked={scope === 'range'}
                onChange={() => setScope('range')}
              />
              A page range
            </label>
            <div className={styles.blockBody}>
              <input
                type="text"
                className={styles.input}
                placeholder="1-4, 9"
                value={rangeText}
                aria-label="Pages to crop"
                onChange={(event) => {
                  setScope('range');
                  setRangeText(event.target.value);
                }}
              />
            </div>
          </div>
        </fieldset>

        <label className={styles.choice}>
          <input
            type="checkbox"
            checked={resizePage}
            onChange={(event) => setResizePage(event.target.checked)}
          />
          <span className={styles.choiceText}>
            Change the page size as well
            <span className={styles.hint}>
              Cropping normally only hides what is outside the box and can be undone by resetting
              it. This also makes the page itself smaller, which discards what was outside.
            </span>
          </span>
        </label>

        {problem === null && resulting !== null ? (
          <p className={styles.summary}>
            {`${String(pages.length)} page${pages.length === 1 ? '' : 's'}; the first becomes ${resulting.width.toFixed(0)} × ${resulting.height.toFixed(0)} points.`}
          </p>
        ) : (
          problem !== null && <p className={styles.problem}>{problem}</p>
        )}
      </div>
    </Dialog>
  );
}
