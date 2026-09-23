import { useState, type PointerEvent, type ReactElement } from 'react';
import { ChevronDown, ChevronUp, RotateCcwSquare, RotateCwSquare, X } from 'lucide-react';
import { IconButton } from '../controls/IconButton';
import { cx } from '../../utils/classNames';
import { pagesOf, problemOf, useCreateStore, type SourceEntry } from '../../stores/createStore';
import { SourcePreview } from './SourcePreview';
import styles from './SourceList.module.css';

/** How wide a source's first page is drawn. */
const PREVIEW_WIDTH = 64;

const KIND_LABELS = {
  pdf: 'PDF',
  image: 'Image',
  text: 'Text',
  html: 'Web page',
} as const;

/**
 * The files the new document is being made from, in the order they will be
 * read.
 *
 * Each row says what the file was, how many pages it became, and how many of
 * them the new document takes; a range that is not a range says so rather than
 * being quietly ignored.
 */
export function SourceList({ entries }: { entries: readonly SourceEntry[] }): ReactElement {
  const move = useCreateStore((state) => state.move);
  const remove = useCreateStore((state) => state.remove);
  const rotate = useCreateStore((state) => state.rotate);
  const setRange = useCreateStore((state) => state.setRange);
  const busy = useCreateStore((state) => state.busy);
  const [dragging, setDragging] = useState<string | null>(null);

  const onPointerDown = (event: PointerEvent<HTMLElement>, id: string): void => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(id);
  };

  const onPointerMove = (event: PointerEvent<HTMLElement>): void => {
    if (dragging === null) return;
    const rows = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-source]')];
    const over = rows.findIndex((row) => {
      const box = row.getBoundingClientRect();
      return event.clientY < box.top + box.height / 2;
    });
    move(dragging, over < 0 ? rows.length - 1 : over);
  };

  return (
    <ol
      className={styles.list}
      aria-label="Files to combine"
      onPointerMove={onPointerMove}
      onPointerUp={() => setDragging(null)}
      onPointerCancel={() => setDragging(null)}
    >
      {entries.map((entry, index) => {
        const problem = problemOf(entry);
        const taken = pagesOf(entry);
        const id = entry.source.id;

        return (
          <li
            key={id}
            className={cx(styles.row, dragging === id && styles.dragging)}
            data-source={id}
          >
            <span
              className={styles.handle}
              aria-hidden="true"
              onPointerDown={(event) => onPointerDown(event, id)}
            >
              <span className={styles.position}>{index + 1}</span>
            </span>

            <SourcePreview sourceId={id} width={PREVIEW_WIDTH} rotation={entry.rotation} />

            <span className={styles.details}>
              <span className={styles.name} title={entry.source.fileName}>
                {entry.source.fileName}
              </span>
              <span className={styles.facts}>
                <span className={styles.kind}>{KIND_LABELS[entry.source.kind]}</span>
                {`${String(entry.source.pageCount)} page${entry.source.pageCount === 1 ? '' : 's'}`}
                {taken !== null && ` · taking ${String(taken.length)}`}
                {entry.rotation !== 0 && ` · turned ${String(entry.rotation)}°`}
              </span>
            </span>

            <span className={styles.range}>
              <label className={styles.rangeLabel} htmlFor={`range-${id}`}>
                Pages
              </label>
              <input
                id={`range-${id}`}
                type="text"
                className={cx(styles.input, problem !== null && styles.invalid)}
                placeholder="All"
                value={entry.rangeText}
                disabled={busy}
                aria-invalid={problem !== null}
                onChange={(event) => setRange(id, event.target.value)}
              />
            </span>

            <span className={styles.actions}>
              <IconButton
                icon={RotateCcwSquare}
                label={`Rotate ${entry.source.fileName} left`}
                size="small"
                disabled={busy}
                onClick={() => rotate(id, -1)}
              />
              <IconButton
                icon={RotateCwSquare}
                label={`Rotate ${entry.source.fileName} right`}
                size="small"
                disabled={busy}
                onClick={() => rotate(id, 1)}
              />
              <IconButton
                icon={ChevronUp}
                label={`Move ${entry.source.fileName} up`}
                size="small"
                disabled={busy || index === 0}
                onClick={() => move(id, index - 1)}
              />
              <IconButton
                icon={ChevronDown}
                label={`Move ${entry.source.fileName} down`}
                size="small"
                disabled={busy || index === entries.length - 1}
                onClick={() => move(id, index + 1)}
              />
              <IconButton
                icon={X}
                label={`Remove ${entry.source.fileName}`}
                size="small"
                disabled={busy}
                onClick={() => void remove(id)}
              />
            </span>

            {problem !== null && <p className={styles.problem}>{problem}</p>}
          </li>
        );
      })}
    </ol>
  );
}
