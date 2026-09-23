import type { ReactElement } from 'react';
import { Check, PenLine, Redo2, Save, Undo2 } from 'lucide-react';
import { Button } from '../controls/Button';
import { CommandIconButton } from '../controls/CommandIconButton';
import { useTextEditStore } from '../../stores/textEditStore';
import styles from './TextEditToolbar.module.css';

/**
 * The bar that says the text editor is on, and how to use it.
 *
 * It appears under the viewer toolbar while editing, so the page keeps as much
 * room as it can, and it says plainly what the editor can and cannot do rather
 * than leaving the reader to find out by clicking.
 */
export function TextEditToolbar({ disabled }: { disabled: boolean }): ReactElement {
  const setActive = useTextEditStore((store) => store.setActive);
  const busy = useTextEditStore((store) => store.busy);
  const selected = useTextEditStore((store) => store.selected);
  const editing = useTextEditStore((store) => store.draft !== null);

  return (
    <div className={styles.bar} role="toolbar" aria-label="Text editing">
      <span className={styles.badge}>
        <PenLine className={styles.icon} aria-hidden="true" strokeWidth={1.75} />
        Edit text
      </span>

      <p className={styles.hint} aria-live="polite">
        {editing
          ? 'Enter keeps the change, Escape leaves the text as it was.'
          : selected === null
            ? 'Click a piece of text to select it, then click again to type.'
            : 'Click again to type, or press Enter.'}
      </p>

      <div className={styles.end}>
        <CommandIconButton id="edit.undo" icon={Undo2} disabled={busy} />
        <CommandIconButton id="edit.redo" icon={Redo2} disabled={busy} />
        <CommandIconButton id="file.save" icon={Save} disabled={busy} />
        <span className={styles.divider} aria-hidden="true" />
        <Button
          appearance="primary"
          icon={Check}
          disabled={disabled}
          onClick={() => setActive(false)}
        >
          Done
        </Button>
      </div>
    </div>
  );
}
