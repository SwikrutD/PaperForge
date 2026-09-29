import { useEffect, useState, type ReactElement } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { SanitizeCategory } from '@shared/schemas/sanitize';
import { SANITIZE_CATEGORY_DESCRIPTIONS, SANITIZE_CATEGORY_LABELS } from '@shared/schemas/sanitize';
import { useAdminStore } from '../../stores/adminStore';
import { useDocumentStore } from '../../stores/documentStore';
import { useUiStore } from '../../stores/uiStore';
import { Button } from '../controls/Button';
import { Dialog } from '../overlays/Dialog';
import { cx } from '../../utils/classNames';
import form from '../overlays/dialogForm.module.css';
import styles from './admin.module.css';

/**
 * Remove Hidden Information.
 *
 * The scan describes what is actually in the document; nothing is removed
 * until the reader chooses categories and says so. A script or a launch action
 * found here is listed and deleted — never run (CLAUDE.md section 22).
 */
export function SanitizeDialog({ onClose }: { onClose: () => void }): ReactElement {
  const tab = useDocumentStore((state) => {
    const active = state.activeId;
    return state.tabs.find((candidate) => candidate.session.id === active) ?? null;
  });
  const report = useAdminStore((state) => state.report);
  const reportFor = useAdminStore((state) => state.reportFor);
  const busy = useAdminStore((state) => state.busy);
  const showToast = useUiStore((state) => state.showToast);

  const sessionId = tab?.session.id ?? null;
  const revision = tab?.edit.revision ?? 0;

  const [chosen, setChosen] = useState<Set<SanitizeCategory>>(new Set());
  const [saveCopy, setSaveCopy] = useState(true);
  const [working, setWorking] = useState(false);

  // Rescanned whenever the document changes underneath, because what is left
  // to remove is exactly what the last removal did not take.
  useEffect(() => {
    if (sessionId === null) return;
    if (reportFor?.sessionId === sessionId && reportFor.revision === revision) return;
    void useAdminStore
      .getState()
      .scan(sessionId)
      .then((scanned) => {
        if (scanned === null) return;
        // Everything found is ticked to start with: a reader who opened this
        // dialog came to remove things, not to tick boxes one by one.
        setChosen(
          new Set(scanned.findings.filter((finding) => finding.count > 0).map((f) => f.category)),
        );
      });
  }, [sessionId, revision, reportFor]);

  const ready = report !== null && reportFor?.sessionId === sessionId;
  const findings = ready ? report.findings : [];
  const found = findings.filter((finding) => finding.count > 0);
  const selected = [...chosen].filter((category) =>
    found.some((finding) => finding.category === category),
  );

  const toggle = (category: SanitizeCategory, on: boolean): void => {
    setChosen((current) => {
      const next = new Set(current);
      if (on) next.add(category);
      else next.delete(category);
      return next;
    });
  };

  const apply = async (): Promise<void> => {
    if (sessionId === null || selected.length === 0) return;
    setWorking(true);
    try {
      const removed = await useAdminStore.getState().removeHiddenInformation(selected);
      if (!removed) return;

      if (saveCopy) await useDocumentStore.getState().save(sessionId, 'saveCopy');
      else {
        showToast({
          title: 'Hidden information removed',
          description: 'Save the document to write the change to the file.',
          intent: 'success',
        });
      }
      onClose();
    } finally {
      setWorking(false);
    }
  };

  return (
    <Dialog
      title="Remove Hidden Information"
      description="What this document carries besides the pages it shows."
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            appearance="primary"
            disabled={busy || working || selected.length === 0}
            onClick={() => void apply()}
          >
            {saveCopy ? 'Remove and save a copy' : 'Remove'}
          </Button>
        </>
      }
    >
      <div className={form.form}>
        {!ready ? (
          <p className={form.summary}>Looking through the document…</p>
        ) : (
          <>
            {found.length === 0 ? (
              <p className={form.summary}>
                Nothing hidden was found. This document carries no metadata, attachments, scripts or
                hidden comments that PaperForge can detect.
              </p>
            ) : (
              <ul className={styles.findings}>
                {findings.map((finding) => {
                  const empty = finding.count === 0;
                  return (
                    <li
                      key={finding.category}
                      className={cx(styles.finding, empty && styles.findingEmpty)}
                    >
                      <input
                        type="checkbox"
                        id={`sanitize-${finding.category}`}
                        checked={chosen.has(finding.category) && !empty}
                        disabled={empty}
                        onChange={(event) => toggle(finding.category, event.target.checked)}
                      />
                      <span className={styles.findingText}>
                        <label
                          className={styles.findingTitle}
                          htmlFor={`sanitize-${finding.category}`}
                        >
                          {SANITIZE_CATEGORY_LABELS[finding.category]}
                        </label>
                        <span className={styles.findingDetail}>
                          {empty
                            ? SANITIZE_CATEGORY_DESCRIPTIONS[finding.category]
                            : finding.detail}
                        </span>
                      </span>
                      <span className={styles.count}>{empty ? 'None' : String(finding.count)}</span>
                    </li>
                  );
                })}
              </ul>
            )}

            {report.hasIncrementalUpdates && (
              <p className={styles.warningBar}>
                <AlertTriangle
                  className={styles.warningIcon}
                  aria-hidden="true"
                  strokeWidth={1.8}
                />
                <span>
                  This file has been saved more than once, so earlier versions of its pages may
                  still be inside it. Saving from PaperForge rewrites the whole file and leaves them
                  behind.
                </span>
              </p>
            )}

            <fieldset className={form.group}>
              <legend className={form.legend}>Where it goes</legend>
              <label className={form.choice}>
                <input
                  type="radio"
                  name="sanitize-target"
                  checked={saveCopy}
                  onChange={() => setSaveCopy(true)}
                />
                <span className={form.choiceText}>
                  Save a cleaned copy
                  <span className={form.hint}>
                    The document you have open keeps everything it carries.
                  </span>
                </span>
              </label>
              <label className={form.choice}>
                <input
                  type="radio"
                  name="sanitize-target"
                  checked={!saveCopy}
                  onChange={() => setSaveCopy(false)}
                />
                <span className={form.choiceText}>
                  Change this document
                  <span className={form.hint}>Undo puts it back until you save.</span>
                </span>
              </label>
            </fieldset>

            <p className={form.summary}>
              PaperForge does not run anything it finds. A script or a launch action is described
              here and then deleted, never performed.
            </p>
          </>
        )}
      </div>
    </Dialog>
  );
}
