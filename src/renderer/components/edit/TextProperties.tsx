import type { ReactElement } from 'react';
import { useDocumentStore } from '../../stores/documentStore';
import { runsFor, useTextEditStore } from '../../stores/textEditStore';
import styles from './TextProperties.module.css';

/**
 * What the selected text is: the font that drew it, its size and colour, and
 * whether PaperForge can write it back.
 *
 * These are facts read from the document, not settings — changing the font or
 * the size of existing text is part of the typography work that follows.
 */
export function TextProperties(): ReactElement {
  const selected = useTextEditStore((store) => store.selected);
  const pages = useTextEditStore((store) => store.pages);
  const sessionId = useDocumentStore((store) => store.activeId);

  const run =
    selected === null || sessionId === null
      ? undefined
      : runsFor(pages, sessionId, selected.page).find((entry) => entry.id === selected.id);

  if (run === undefined) {
    return (
      <div className={styles.panel}>
        <p className={styles.empty}>
          Click a piece of text on the page to see what drew it, then click again to change it.
        </p>
      </div>
    );
  }

  const color = `rgb(${[run.color.r, run.color.g, run.color.b]
    .map((part) => Math.round(part * 255))
    .join(' ')})`;

  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <h3 className={styles.title}>Text</h3>
        <p className={styles.sample} title={run.text}>
          {run.text}
        </p>
      </header>

      <dl className={styles.list}>
        <div className={styles.row}>
          <dt className={styles.label}>Font</dt>
          <dd className={styles.value}>{run.baseFont}</dd>
        </div>
        <div className={styles.row}>
          <dt className={styles.label}>Size</dt>
          <dd className={styles.value}>{`${round(run.fontSize)} pt`}</dd>
        </div>
        <div className={styles.row}>
          <dt className={styles.label}>Colour</dt>
          <dd className={styles.value}>
            <span className={styles.swatch} style={{ backgroundColor: color }} aria-hidden="true" />
            {color}
          </dd>
        </div>
        <div className={styles.row}>
          <dt className={styles.label}>Position</dt>
          <dd className={styles.value}>{`${round(run.baselineX)}, ${round(run.baselineY)}`}</dd>
        </div>
        {run.rotation !== 0 && (
          <div className={styles.row}>
            <dt className={styles.label}>Turned</dt>
            <dd className={styles.value}>{`${round(run.rotation)}°`}</dd>
          </div>
        )}
        {run.invisible && (
          <div className={styles.row}>
            <dt className={styles.label}>Drawn</dt>
            <dd className={styles.value}>Invisibly, as a text layer</dd>
          </div>
        )}
      </dl>

      <p className={run.editable ? styles.note : styles.warning}>
        {run.editable
          ? 'Click the text again to change it. It is written in the same font, so the page still looks like itself.'
          : (run.reason ?? 'This text cannot be changed.')}
      </p>
    </div>
  );
}

function round(value: number): string {
  return (Math.round(value * 100) / 100).toString();
}
