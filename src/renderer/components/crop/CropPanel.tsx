import type { ReactElement } from 'react';
import { frameOf, visibleBox, type CropMargins } from '@shared/utils/cropBoxes';
import { useDocumentStore } from '../../stores/documentStore';
import { frameMargins, pagesInScope, useCropStore } from '../../stores/cropStore';
import { Button } from '../controls/Button';
import { PageBoxesList } from '../organize/PageProperties';
import form from '../overlays/dialogForm.module.css';
import styles from './CropPanel.module.css';

const EDGES = [
  { key: 'top', label: 'Top' },
  { key: 'bottom', label: 'Bottom' },
  { key: 'left', label: 'Left' },
  { key: 'right', label: 'Right' },
] as const;

/**
 * The crop tool's controls: the frame as margins, which pages it applies to,
 * and the boxes the page declares now.
 */
export function CropPanel(): ReactElement {
  const tab = useDocumentStore((state) => {
    const active = state.activeId;
    return state.tabs.find((candidate) => candidate.session.id === active) ?? null;
  });
  const frame = useCropStore((state) => state.frame);
  const boxes = useCropStore((state) => state.boxes);
  const scope = useCropStore((state) => state.scope);
  const rangeText = useCropStore((state) => state.rangeText);
  const resizePage = useCropStore((state) => state.resizePage);
  const store = useCropStore.getState;

  const sessionId = tab?.session.id ?? null;
  const pageCount = tab?.pageCount ?? 0;
  const ownFrame = frame !== null && frame.sessionId === sessionId ? frame : null;
  const margins = frameMargins(ownFrame, boxes);
  const shownPage = ownFrame?.page ?? tab?.view.pageNumber ?? 1;
  const entry = boxes.find((candidate) => candidate.pageNumber === shownPage);
  const chosen = pagesInScope(scope, rangeText, ownFrame?.page ?? null, pageCount);

  const setMargin = (key: keyof CropMargins, value: number): void => {
    if (ownFrame === null || margins === null || entry === undefined) return;
    const next = { ...margins, [key]: Math.max(0, value) };
    store().setFrame({ ...ownFrame, rect: frameOf(visibleBox(entry), next) });
  };

  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <h2 className={styles.title}>Crop Pages</h2>
        <p className={styles.note}>
          Drag on a page to draw what it should show. The margins it leaves can then be applied to
          that page, every page, or a range.
        </p>
      </header>

      <fieldset className={form.group}>
        <legend className={form.legend}>
          {margins === null ? 'Margins' : `Margins on page ${String(ownFrame?.page ?? '')}`}
        </legend>
        {margins === null ? (
          <p className={styles.empty}>No frame yet. Drag on a page to draw one.</p>
        ) : (
          EDGES.map((edge) => (
            <div className={form.row} key={edge.key}>
              <label className={form.label} htmlFor={`crop-margin-${edge.key}`}>
                {edge.label}
              </label>
              <input
                id={`crop-margin-${edge.key}`}
                type="number"
                className={`${form.input} ${form.number}`}
                min={0}
                max={10000}
                step={1}
                value={margins[edge.key]}
                onChange={(event) => setMargin(edge.key, Number(event.target.value) || 0)}
              />
              <span className={styles.unit}>pt</span>
            </div>
          ))
        )}
      </fieldset>

      <fieldset className={form.group}>
        <legend className={form.legend}>Apply to</legend>
        <label className={form.choice}>
          <input
            type="radio"
            name="crop-tool-scope"
            checked={scope === 'page'}
            onChange={() => store().setScope('page')}
          />
          <span className={form.choiceText}>
            {ownFrame === null ? 'The page the frame is on' : `Page ${String(ownFrame.page)}`}
          </span>
        </label>
        <label className={form.choice}>
          <input
            type="radio"
            name="crop-tool-scope"
            checked={scope === 'all'}
            onChange={() => store().setScope('all')}
          />
          <span className={form.choiceText}>{`All ${String(pageCount)} pages`}</span>
        </label>
        <label className={form.choice}>
          <input
            type="radio"
            name="crop-tool-scope"
            checked={scope === 'range'}
            onChange={() => store().setScope('range')}
          />
          A page range
        </label>
        <input
          type="text"
          className={form.input}
          placeholder="1-4, 9"
          value={rangeText}
          aria-label="Pages to crop"
          onChange={(event) => store().setRangeText(event.target.value)}
        />
        <label className={form.choice}>
          <input
            type="checkbox"
            checked={resizePage}
            onChange={(event) => store().setResizePage(event.target.checked)}
          />
          <span className={form.choiceText}>
            Change the page size as well
            <span className={form.hint}>
              Cropping normally only hides what is outside the frame, and Reset crop brings it back.
              This makes the page itself smaller, which discards what was outside.
            </span>
          </span>
        </label>
        {'problem' in chosen && <p className={form.problem}>{chosen.problem}</p>}
      </fieldset>

      <div className={styles.actions}>
        <Button
          disabled={sessionId === null || 'problem' in chosen}
          onClick={() => sessionId !== null && void store().reset(sessionId, pageCount)}
        >
          Reset crop
        </Button>
        <Button
          appearance="primary"
          disabled={sessionId === null || margins === null || 'problem' in chosen}
          onClick={() => sessionId !== null && void store().apply(sessionId, pageCount)}
        >
          Apply crop
        </Button>
      </div>

      <section className={styles.boxes} aria-label={`Boxes of page ${String(shownPage)}`}>
        <h3 className={styles.subtitle}>{`Page ${String(shownPage)} declares`}</h3>
        {entry === undefined ? (
          <p className={styles.empty}>The boxes of this page have not been read yet.</p>
        ) : (
          <PageBoxesList entry={entry} />
        )}
        <p className={styles.note}>
          Measured in points; 72 points is one inch. Bleed, trim and art boxes are shown as the page
          declares them and are not changed by cropping.
        </p>
      </section>
    </div>
  );
}
