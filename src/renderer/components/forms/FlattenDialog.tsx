import { useState, type ReactElement } from 'react';
import { Button } from '../controls/Button';
import { Dialog } from '../overlays/Dialog';
import { useDocumentStore } from '../../stores/documentStore';
import { formFieldsFor, useFormStore } from '../../stores/formStore';
import { annotationsForSession, useAnnotationStore } from '../../stores/annotationStore';
import styles from '../overlays/dialogForm.module.css';

/**
 * Flattening: turning fields and marks into part of the page.
 *
 * It cannot be undone once the file is written, so PaperForge writes a copy
 * unless the reader says otherwise, and says what will stop being editable
 * before it does it.
 */
export function FlattenDialog({ onClose }: { onClose: () => void }): ReactElement {
  const sessionId = useDocumentStore((store) => store.activeId);
  const forms = useFormStore((store) => store.forms);
  const annotations = useAnnotationStore((store) =>
    sessionId === null ? [] : annotationsForSession(store, sessionId),
  );

  const [fields, setFields] = useState(true);
  const [marks, setMarks] = useState(true);
  const [asCopy, setAsCopy] = useState(true);
  const [busy, setBusy] = useState(false);

  const fieldCount = formFieldsFor(forms, sessionId).length;
  const markCount = annotations.length;
  const nothing = (!fields || fieldCount === 0) && (!marks || markCount === 0);

  const apply = async (): Promise<void> => {
    if (sessionId === null) return;
    setBusy(true);
    try {
      const operations = [
        ...(fields && fieldCount > 0 ? [{ kind: 'flattenFields' as const, names: null }] : []),
        ...(marks && markCount > 0 ? [{ kind: 'flattenAnnotations' as const, ids: null }] : []),
      ];
      if (operations.length === 0) return;

      await useDocumentStore.getState().applyEdit(sessionId, { label: 'Flatten', operations });
      if (asCopy) void useDocumentStore.getState().save(sessionId, 'saveCopy');
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Flatten"
      description="Draws the fields and marks onto the page itself. They stay exactly as they look, and stop being things that can be filled in, moved or taken off."
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            appearance="primary"
            onClick={() => void apply()}
            disabled={busy || nothing || sessionId === null}
          >
            {asCopy ? 'Flatten and save a copy' : 'Flatten'}
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <fieldset className={styles.group}>
          <legend className={styles.legend}>What to flatten</legend>
          <label className={styles.choice}>
            <input
              type="checkbox"
              checked={fields}
              disabled={fieldCount === 0}
              onChange={(event) => setFields(event.target.checked)}
            />
            <span className={styles.choiceText}>
              {`Form fields (${String(fieldCount)})`}
              <span className={styles.hint}>
                What each field holds is drawn on the page; the field itself is taken away.
              </span>
            </span>
          </label>
          <label className={styles.choice}>
            <input
              type="checkbox"
              checked={marks}
              disabled={markCount === 0}
              onChange={(event) => setMarks(event.target.checked)}
            />
            <span className={styles.choiceText}>
              {`Comments and signatures (${String(markCount)})`}
              <span className={styles.hint}>
                Highlights, notes, stamps and signatures become part of the page.
              </span>
            </span>
          </label>
        </fieldset>

        <fieldset className={styles.group}>
          <legend className={styles.legend}>Where it goes</legend>
          <label className={styles.choice}>
            <input
              type="radio"
              name="flatten-target"
              checked={asCopy}
              onChange={() => setAsCopy(true)}
            />
            <span className={styles.choiceText}>
              Save a copy
              <span className={styles.hint}>
                The document you have open keeps its fields and marks.
              </span>
            </span>
          </label>
          <label className={styles.choice}>
            <input
              type="radio"
              name="flatten-target"
              checked={!asCopy}
              onChange={() => setAsCopy(false)}
            />
            <span className={styles.choiceText}>
              Change this document
              <span className={styles.hint}>
                Undo puts it back until you save; after saving, it is flattened for good.
              </span>
            </span>
          </label>
        </fieldset>

        <p className={styles.summary}>
          A flattened document can still be read and printed, and its text can still be selected —
          but nothing on it can be filled in or taken off again.
        </p>
      </div>
    </Dialog>
  );
}
