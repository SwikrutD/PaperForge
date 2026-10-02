import type { ReactElement } from 'react';
import { Trash2 } from 'lucide-react';
import { useCommands } from '../../commands/useCommands';
import { useDocumentStore } from '../../stores/documentStore';
import { marksFor, useRedactionStore, type PendingMark } from '../../stores/redactionStore';
import { cx } from '../../utils/classNames';
import { Button } from '../controls/Button';
import { IconButton } from '../controls/IconButton';
import styles from './RedactionPanel.module.css';

/** The colours a redaction box can be painted, named as a reader would. */
const FILLS = [
  { label: 'Black', fill: { r: 0, g: 0, b: 0 } },
  { label: 'Dark grey', fill: { r: 0.25, g: 0.25, b: 0.25 } },
  { label: 'White', fill: { r: 1, g: 1, b: 1 } },
] as const;

const SOURCES: Record<PendingMark['source'], string> = {
  text: 'Selected text',
  area: 'Area',
  search: 'Found text',
};

/**
 * Every mark waiting to be applied, page by page, and what the boxes will
 * look like. Nothing here changes the document; applying does.
 */
export function RedactionPanel(): ReactElement {
  const { execute } = useCommands();
  const sessionId = useDocumentStore((state) => state.activeId);
  const updateView = useDocumentStore((state) => state.updateView);
  const marks = useRedactionStore((state) => marksFor(state.marks, sessionId));
  const selectedId = useRedactionStore((state) => state.selectedId);
  const appearance = useRedactionStore((state) => state.appearance);
  const store = useRedactionStore.getState;

  const ordered = [...marks].sort((first, second) => first.page - second.page);

  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <h2 className={styles.title}>Redact</h2>
        <p className={styles.note}>
          Marked areas are only outlined until you apply them. Applying removes the text, pictures
          and comments under each mark from the document itself, not just from view.
        </p>
      </header>

      {ordered.length === 0 ? (
        <p className={styles.empty}>
          Nothing is marked yet. Select text, drag over an area, or find text to mark every place it
          occurs.
        </p>
      ) : (
        <ul className={styles.list} aria-label="Marked for redaction">
          {ordered.map((mark) => (
            <li
              key={mark.id}
              className={cx(styles.item, selectedId === mark.id && styles.itemSelected)}
            >
              <button
                type="button"
                className={styles.itemBody}
                onClick={() => {
                  store().select(mark.id);
                  if (sessionId !== null) updateView(sessionId, { pendingPage: mark.page });
                }}
              >
                <span className={styles.itemLabel}>{mark.label}</span>
                <span className={styles.itemMeta}>
                  Page {mark.page} · {SOURCES[mark.source]}
                  {mark.reason === null ? '' : ` · ${mark.reason}`}
                </span>
              </button>
              <IconButton
                icon={Trash2}
                label={`Remove mark: ${mark.label}`}
                size="small"
                onClick={() => sessionId !== null && store().removeMark(sessionId, mark.id)}
              />
            </li>
          ))}
        </ul>
      )}

      <fieldset className={styles.group}>
        <legend className={styles.legend}>Redaction boxes</legend>
        <div className={styles.swatches} role="radiogroup" aria-label="Box colour">
          {FILLS.map((option) => {
            const chosen =
              appearance.fill.r === option.fill.r &&
              appearance.fill.g === option.fill.g &&
              appearance.fill.b === option.fill.b;
            return (
              <button
                key={option.label}
                type="button"
                role="radio"
                aria-checked={chosen}
                className={cx(styles.swatch, chosen && styles.swatchChosen)}
                title={option.label}
                aria-label={option.label}
                style={{
                  backgroundColor: `rgb(${String(option.fill.r * 255)}, ${String(
                    option.fill.g * 255,
                  )}, ${String(option.fill.b * 255)})`,
                }}
                onClick={() => store().setAppearance({ ...appearance, fill: option.fill })}
              />
            );
          })}
        </div>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={appearance.showReason}
            onChange={(event) =>
              store().setAppearance({ ...appearance, showReason: event.target.checked })
            }
          />
          Write the reason on each box
        </label>
      </fieldset>

      <div className={styles.actions}>
        <Button
          disabled={ordered.length === 0}
          onClick={() => sessionId !== null && store().clearMarks(sessionId)}
        >
          Clear all
        </Button>
        <Button
          appearance="primary"
          disabled={ordered.length === 0}
          onClick={() => execute('redact.apply')}
        >
          Apply Redactions…
        </Button>
      </div>
    </div>
  );
}
