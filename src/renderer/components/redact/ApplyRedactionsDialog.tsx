import { useEffect, useState, type ReactElement } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { RedactionPlan } from '@shared/schemas/redaction';
import { useDocumentStore } from '../../stores/documentStore';
import { marksFor, useRedactionStore } from '../../stores/redactionStore';
import { Button } from '../controls/Button';
import { Dialog } from '../overlays/Dialog';
import { usePdfDocumentContext } from '../viewer/pdfDocumentContextValue';
import form from '../overlays/dialogForm.module.css';
import styles from './ApplyRedactionsDialog.module.css';

/**
 * Apply Redactions: the review before anything is removed.
 *
 * The plan comes from reading the document, not from the marks alone — it
 * says what text each mark will take, and which pages cannot be cut without
 * drawing them as pictures, and why. Saving as a new file is the default, so
 * the original stays as it was (CLAUDE.md section 21).
 */
export function ApplyRedactionsDialog({ onClose }: { onClose: () => void }): ReactElement {
  const tab = useDocumentStore((state) => {
    const active = state.activeId;
    return state.tabs.find((candidate) => candidate.session.id === active) ?? null;
  });
  const sessionId = tab?.session.id ?? null;
  const revision = tab?.edit.revision ?? 0;
  const marks = useRedactionStore((state) => marksFor(state.marks, sessionId));
  const applying = useRedactionStore((state) => state.applying);
  const { document } = usePdfDocumentContext();

  const [plan, setPlan] = useState<RedactionPlan | null>(null);
  const [rasterizeAll, setRasterizeAll] = useState(false);
  const [sanitize, setSanitize] = useState(false);
  const [saveAs, setSaveAs] = useState(true);

  useEffect(() => {
    if (sessionId === null || marks.length === 0) return;
    let current = true;
    void useRedactionStore
      .getState()
      .plan(sessionId)
      .then((next) => {
        if (current) setPlan(next);
      });
    return () => {
      current = false;
    };
  }, [sessionId, marks, revision]);

  const pageCount = new Set(marks.map((mark) => mark.page)).size;
  const stale = marks.some((mark) => mark.revision !== revision);
  const pictured = plan?.pages.filter((page) => rasterizeAll || page.mode === 'raster') ?? [];
  const ready = plan !== null && plan.revision === revision && document !== null;

  const apply = async (): Promise<void> => {
    if (sessionId === null || plan === null || document === null) return;
    const applied = await useRedactionStore
      .getState()
      .apply(sessionId, document, plan, { rasterizeAll, sanitize, saveAs });
    if (applied) onClose();
  };

  return (
    <Dialog
      title="Apply Redactions"
      description={`${String(marks.length)} ${marks.length === 1 ? 'mark' : 'marks'} on ${String(
        pageCount,
      )} ${pageCount === 1 ? 'page' : 'pages'}.`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={applying}>
            Cancel
          </Button>
          <Button
            appearance="danger"
            disabled={!ready || applying || marks.length === 0}
            onClick={() => void apply()}
          >
            {applying ? 'Applying…' : 'Apply Redactions'}
          </Button>
        </>
      }
    >
      <div className={form.form}>
        {plan === null ? (
          <p className={form.summary}>Reading what lies under each mark…</p>
        ) : (
          <>
            <section className={styles.section} aria-label="What will be removed">
              <h3 className={styles.heading}>What will be removed</h3>
              <ul className={styles.list}>
                {marks.map((mark) => {
                  const found = plan.marks.find((entry) => entry.id === mark.id);
                  const extras = [
                    found !== undefined && found.images > 0
                      ? `${String(found.images)} ${found.images === 1 ? 'picture' : 'pictures'}`
                      : null,
                    found !== undefined && found.annotations > 0
                      ? `${String(found.annotations)} ${
                          found.annotations === 1 ? 'comment or field' : 'comments or fields'
                        }`
                      : null,
                  ].filter((entry): entry is string => entry !== null);
                  return (
                    <li key={mark.id} className={styles.item}>
                      <span className={styles.itemText}>
                        {found === undefined || found.text === '' ? (
                          <em>No text</em>
                        ) : (
                          `“${found.text}”`
                        )}
                        {extras.length > 0 && (
                          <span className={styles.itemExtra}> and {extras.join(', ')}</span>
                        )}
                      </span>
                      <span className={styles.itemPage}>Page {mark.page}</span>
                    </li>
                  );
                })}
              </ul>
            </section>

            {pictured.length > 0 && (
              <section className={styles.section} aria-label="Pages drawn as pictures">
                <h3 className={styles.heading}>Drawn as pictures</h3>
                <p className={form.hint}>
                  {pictured.length === 1 ? 'This page' : 'These pages'} will be replaced by a
                  picture of the page with the marks painted on. Their text can no longer be
                  selected or searched; Recognize Text can make it searchable again.
                </p>
                <ul className={styles.list}>
                  {pictured.map((page) => (
                    <li key={page.page} className={styles.item}>
                      <span className={styles.itemText}>
                        {page.reasons.length === 0 ? 'You chose this.' : page.reasons.join(' ')}
                      </span>
                      <span className={styles.itemPage}>Page {page.page}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {(stale || plan.notes.length > 0) && (
              <div className={styles.notes}>
                {stale && (
                  <p className={styles.warning}>
                    <AlertTriangle className={styles.icon} aria-hidden="true" strokeWidth={1.8} />
                    <span>
                      The document has changed since some of these marks were made. Check that each
                      one still covers what it should.
                    </span>
                  </p>
                )}
                {plan.notes.map((note) => (
                  <p key={note} className={form.hint}>
                    {note}
                  </p>
                ))}
              </div>
            )}

            <fieldset className={form.group}>
              <legend className={form.legend}>Options</legend>
              <label className={form.choice}>
                <input
                  type="checkbox"
                  checked={rasterizeAll}
                  onChange={(event) => setRasterizeAll(event.target.checked)}
                />
                <span className={form.choiceText}>
                  Draw every marked page as a picture
                  <span className={form.hint}>
                    The most thorough choice. Text on those pages can no longer be selected.
                  </span>
                </span>
              </label>
              <label className={form.choice}>
                <input
                  type="checkbox"
                  checked={sanitize}
                  onChange={(event) => setSanitize(event.target.checked)}
                />
                <span className={form.choiceText}>
                  Also remove hidden information
                  <span className={form.hint}>
                    Metadata, attachments, scripts, hidden comments and layers, and saved page
                    thumbnails.
                  </span>
                </span>
              </label>
            </fieldset>

            <fieldset className={form.group}>
              <legend className={form.legend}>Afterwards</legend>
              <label className={form.choice}>
                <input
                  type="radio"
                  name="redaction-target"
                  checked={saveAs}
                  onChange={() => setSaveAs(true)}
                />
                <span className={form.choiceText}>
                  Save the redacted document as a new file
                  <span className={form.hint}>The file you opened is left as it is.</span>
                </span>
              </label>
              <label className={form.choice}>
                <input
                  type="radio"
                  name="redaction-target"
                  checked={!saveAs}
                  onChange={() => setSaveAs(false)}
                />
                <span className={form.choiceText}>
                  Change this document only
                  <span className={form.hint}>Undo puts it back until you save.</span>
                </span>
              </label>
            </fieldset>

            <p className={styles.warning}>
              <AlertTriangle className={styles.icon} aria-hidden="true" strokeWidth={1.8} />
              <span>
                Once the redacted document is saved, what was under the marks is gone from that file
                and cannot be recovered from it.
              </span>
            </p>
          </>
        )}
      </div>
    </Dialog>
  );
}
