import { useState, type ReactElement } from 'react';
import type { PageLabelStyle } from '@shared/schemas/pages';
import { formatPageLabel } from '@shared/utils/pageLabels';
import { Button } from '../controls/Button';
import { Dialog } from '../overlays/Dialog';
import type { OrganizeActions } from './useOrganizeActions';
import styles from '../overlays/dialogForm.module.css';

interface LabelsDialogProps {
  actions: OrganizeActions;
  pageCount: number;
  onClose: () => void;
}

const STYLES: Array<{ id: PageLabelStyle; label: string; sample: string }> = [
  { id: 'decimal', label: 'Numbers', sample: '1, 2, 3' },
  { id: 'romanLower', label: 'Roman, lower case', sample: 'i, ii, iii' },
  { id: 'romanUpper', label: 'Roman, upper case', sample: 'I, II, III' },
  { id: 'letterLower', label: 'Letters, lower case', sample: 'a, b, c' },
  { id: 'letterUpper', label: 'Letters, upper case', sample: 'A, B, C' },
  { id: 'none', label: 'Prefix only', sample: 'no number' },
];

/**
 * Page numbering: what the document prints on its pages, which is not always
 * the page's position.
 *
 * Numbering starts at the first chosen page and runs to the end, or to the next
 * page that already starts its own numbering.
 */
export function LabelsDialog({ actions, pageCount, onClose }: LabelsDialogProps): ReactElement {
  const fromPage = actions.pages[0] ?? 1;
  const [style, setStyle] = useState<PageLabelStyle>('decimal');
  const [prefix, setPrefix] = useState('');
  const [start, setStart] = useState(1);

  const apply = (): void => {
    actions.renumber(style, prefix, start);
    onClose();
  };

  return (
    <Dialog
      title="Page Numbering"
      description={`From page ${String(fromPage)} of ${String(pageCount)} onwards.`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button appearance="primary" onClick={apply}>
            Apply
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <div className={styles.row}>
          <label className={styles.label} htmlFor="label-style">
            Style
          </label>
          <select
            id="label-style"
            className={styles.select}
            value={style}
            onChange={(event) => setStyle(event.target.value as PageLabelStyle)}
          >
            {STYLES.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {`${entry.label} — ${entry.sample}`}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.row}>
          <label className={styles.label} htmlFor="label-prefix">
            Prefix
          </label>
          <input
            id="label-prefix"
            type="text"
            className={`${styles.input} ${styles.grow}`}
            maxLength={60}
            placeholder="A-"
            value={prefix}
            onChange={(event) => setPrefix(event.target.value)}
          />
        </div>

        <div className={styles.row}>
          <label className={styles.label} htmlFor="label-start">
            Start at
          </label>
          <input
            id="label-start"
            type="number"
            className={`${styles.input} ${styles.number}`}
            min={1}
            max={100000}
            value={start}
            disabled={style === 'none'}
            onChange={(event) => setStart(Math.max(1, Math.trunc(Number(event.target.value) || 1)))}
          />
        </div>

        <p className={styles.summary}>
          {`Page ${String(fromPage)} will be called “${style === 'none' && prefix === '' ? '(nothing)' : formatPageLabel(style, prefix, start)}”. Numbering already set on later pages is kept.`}
        </p>
      </div>
    </Dialog>
  );
}
