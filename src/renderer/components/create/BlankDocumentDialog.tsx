import { useState, type ReactElement } from 'react';
import type { PageOrientation, PaperPreset } from '@shared/schemas/create';
import { PAPER_LABELS, describeSize, resolveSize } from '@pdf/create/paper';
import { Button } from '../controls/Button';
import { Dialog } from '../overlays/Dialog';
import { useCreateStore } from '../../stores/createStore';
import styles from './BlankDocumentDialog.module.css';

const PRESETS: PaperPreset[] = ['a4', 'a3', 'a5', 'letter', 'legal', 'tabloid'];

/** A document with nothing on it yet: paper, how many pages, what it is called. */
export function BlankDocumentDialog({ onClose }: { onClose: () => void }): ReactElement {
  const createBlank = useCreateStore((state) => state.createBlank);
  const busy = useCreateStore((state) => state.busy);
  const [preset, setPreset] = useState<PaperPreset>('a4');
  const [orientation, setOrientation] = useState<PageOrientation>('portrait');
  const [pageCount, setPageCount] = useState(1);
  const [title, setTitle] = useState('');

  const size = { kind: 'preset', preset, orientation } as const;
  const resolved = resolveSize(size);

  const run = (): void => {
    void createBlank({
      size,
      pageCount,
      metadata: { title, author: '' },
    }).then((made) => {
      if (made) onClose();
    });
  };

  return (
    <Dialog
      title="Blank Document"
      description="An empty document, saved where you choose and opened straight away."
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button appearance="primary" onClick={run} disabled={busy}>
            Create…
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <div className={styles.row}>
          <label className={styles.label} htmlFor="blank-paper">
            Paper
          </label>
          <select
            id="blank-paper"
            className={styles.select}
            value={preset}
            onChange={(event) => setPreset(event.target.value as PaperPreset)}
          >
            {PRESETS.map((entry) => (
              <option key={entry} value={entry}>
                {PAPER_LABELS[entry]}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.row}>
          <span className={styles.label}>Orientation</span>
          <div className={styles.choices}>
            {(['portrait', 'landscape'] as const).map((value) => (
              <label className={styles.choice} key={value}>
                <input
                  type="radio"
                  name="blank-orientation"
                  checked={orientation === value}
                  onChange={() => setOrientation(value)}
                />
                {value === 'portrait' ? 'Portrait' : 'Landscape'}
              </label>
            ))}
          </div>
        </div>

        <div className={styles.row}>
          <label className={styles.label} htmlFor="blank-pages">
            Pages
          </label>
          <input
            id="blank-pages"
            type="number"
            className={styles.number}
            min={1}
            max={1000}
            value={pageCount}
            onChange={(event) =>
              setPageCount(Math.max(1, Math.min(1000, Math.trunc(Number(event.target.value) || 1))))
            }
          />
        </div>

        <div className={styles.row}>
          <label className={styles.label} htmlFor="blank-title">
            Title
          </label>
          <input
            id="blank-title"
            type="text"
            className={styles.input}
            maxLength={300}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>

        {resolved !== null && <p className={styles.summary}>{describeSize(resolved)}</p>}
      </div>
    </Dialog>
  );
}
