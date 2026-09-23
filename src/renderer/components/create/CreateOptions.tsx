import type { ReactElement } from 'react';
import type { PageOrientation, PaperPreset } from '@shared/schemas/create';
import { PAPER_LABELS, describeSize, resolveSize } from '@pdf/create/paper';
import { useCreateStore } from '../../stores/createStore';
import styles from './CreateOptions.module.css';

const PRESETS: PaperPreset[] = ['a4', 'a3', 'a5', 'letter', 'legal', 'tabloid'];

/**
 * What the new document is made of, beside the files themselves: the paper
 * anything that is not already a PDF is put on, what its bookmarks are made
 * from, and what it says about itself.
 *
 * Changing the paper converts the staged files again, because that is what
 * changing it has to mean for a file that has already become pages.
 */
export function CreateOptions(): ReactElement {
  const setup = useCreateStore((state) => state.setup);
  const setSetup = useCreateStore((state) => state.setSetup);
  const metadata = useCreateStore((state) => state.metadata);
  const setMetadata = useCreateStore((state) => state.setMetadata);
  const bookmarkPerSource = useCreateStore((state) => state.bookmarkPerSource);
  const setBookmarkPerSource = useCreateStore((state) => state.setBookmarkPerSource);
  const keepBookmarks = useCreateStore((state) => state.keepBookmarks);
  const setKeepBookmarks = useCreateStore((state) => state.setKeepBookmarks);
  const busy = useCreateStore((state) => state.busy);
  const converts = useCreateStore((state) =>
    state.entries.some((entry) => entry.source.kind !== 'pdf'),
  );

  const preset = setup.size.kind === 'preset' ? setup.size.preset : 'a4';
  const orientation = setup.size.kind === 'preset' ? setup.size.orientation : 'portrait';
  const followsImage = setup.size.kind === 'image';
  const resolved = resolveSize(setup.size);

  const choosePaper = (next: { preset?: PaperPreset; orientation?: PageOrientation }): void => {
    void setSetup({
      ...setup,
      size: {
        kind: 'preset',
        preset: next.preset ?? preset,
        orientation: next.orientation ?? orientation,
      },
    });
  };

  return (
    <aside className={styles.panel} aria-label="Options for the new document">
      <section className={styles.group}>
        <h3 className={styles.heading}>Page setup</h3>
        <p className={styles.note}>
          {converts
            ? 'Used for the files that are not already PDFs. A PDF keeps its own pages.'
            : 'Used for images, text files and web pages when you add them.'}
        </p>

        <div className={styles.row}>
          <label className={styles.label} htmlFor="create-paper">
            Paper
          </label>
          <select
            id="create-paper"
            className={styles.select}
            value={followsImage ? 'image' : preset}
            disabled={busy}
            onChange={(event) => {
              if (event.target.value === 'image')
                void setSetup({ ...setup, size: { kind: 'image' } });
              else choosePaper({ preset: event.target.value as PaperPreset });
            }}
          >
            {PRESETS.map((entry) => (
              <option key={entry} value={entry}>
                {PAPER_LABELS[entry]}
              </option>
            ))}
            <option value="image">The image's own size</option>
          </select>
        </div>

        <div className={styles.row}>
          <span className={styles.label}>Orientation</span>
          <div className={styles.choices}>
            {(['portrait', 'landscape'] as const).map((value) => (
              <label className={styles.choice} key={value}>
                <input
                  type="radio"
                  name="create-orientation"
                  checked={!followsImage && orientation === value}
                  disabled={busy || followsImage}
                  onChange={() => choosePaper({ orientation: value })}
                />
                {value === 'portrait' ? 'Portrait' : 'Landscape'}
              </label>
            ))}
          </div>
        </div>

        <div className={styles.row}>
          <label className={styles.label} htmlFor="create-margin">
            Margin
          </label>
          <input
            id="create-margin"
            type="number"
            className={styles.number}
            min={0}
            max={216}
            value={setup.margin}
            disabled={busy}
            onChange={(event) =>
              void setSetup({
                ...setup,
                margin: Math.max(0, Math.min(216, Number(event.target.value) || 0)),
              })
            }
          />
          <span className={styles.suffix}>pt</span>
        </div>

        <p className={styles.note}>
          {resolved === null
            ? 'Each page becomes the size of the image on it.'
            : describeSize(resolved)}
        </p>
      </section>

      <section className={styles.group}>
        <h3 className={styles.heading}>Bookmarks</h3>
        <label className={styles.checkbox}>
          <input
            type="checkbox"
            checked={bookmarkPerSource}
            disabled={busy}
            onChange={(event) => setBookmarkPerSource(event.target.checked)}
          />
          One for each file, named after it
        </label>
        <label className={styles.checkbox}>
          <input
            type="checkbox"
            checked={keepBookmarks}
            disabled={busy}
            onChange={(event) => setKeepBookmarks(event.target.checked)}
          />
          Keep the bookmarks the files already have
        </label>
        <p className={styles.note}>
          A bookmark whose page is not taken is left out; the ones below it are kept.
        </p>
      </section>

      <section className={styles.group}>
        <h3 className={styles.heading}>Document details</h3>
        <div className={styles.row}>
          <label className={styles.label} htmlFor="create-title">
            Title
          </label>
          <input
            id="create-title"
            type="text"
            className={styles.input}
            maxLength={300}
            value={metadata.title}
            disabled={busy}
            onChange={(event) => setMetadata({ title: event.target.value })}
          />
        </div>
        <div className={styles.row}>
          <label className={styles.label} htmlFor="create-author">
            Author
          </label>
          <input
            id="create-author"
            type="text"
            className={styles.input}
            maxLength={200}
            value={metadata.author}
            disabled={busy}
            onChange={(event) => setMetadata({ author: event.target.value })}
          />
        </div>
      </section>
    </aside>
  );
}
