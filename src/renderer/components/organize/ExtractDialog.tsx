import { useState, type ReactElement } from 'react';
import { formatPageRange } from '@shared/utils/pageRange';
import { Button } from '../controls/Button';
import { Dialog } from '../overlays/Dialog';
import type { OrganizeActions } from './useOrganizeActions';
import styles from './organizeDialogs.module.css';

interface ExtractDialogProps {
  actions: OrganizeActions;
  pageCount: number;
  onClose: () => void;
}

/**
 * Extract: writes the chosen pages out as new documents.
 *
 * The pages are only removed from this document once the new files have
 * actually been written, and never when that would leave nothing behind.
 */
export function ExtractDialog({ actions, pageCount, onClose }: ExtractDialogProps): ReactElement {
  const [mode, setMode] = useState<'single' | 'perPage'>('single');
  const [deleteAfter, setDeleteAfter] = useState(false);

  const pages = actions.pages;
  const keepsNothing = pages.length >= pageCount;

  const run = (): void => {
    actions.extract(mode, deleteAfter && !keepsNothing);
    onClose();
  };

  return (
    <Dialog
      title="Extract Pages"
      description={`Pages ${formatPageRange(pages)} of this document.`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button appearance="primary" onClick={run} disabled={pages.length === 0}>
            Extract…
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <fieldset className={styles.group}>
          <legend className={styles.legend}>New documents</legend>
          <label className={styles.choice}>
            <input
              type="radio"
              name="extract-mode"
              checked={mode === 'single'}
              onChange={() => setMode('single')}
            />
            <span className={styles.choiceText}>
              One document
              <span className={styles.hint}>
                {pages.length === 1
                  ? 'The chosen page, in a file of its own.'
                  : `All ${String(pages.length)} chosen pages, in their current order.`}
              </span>
            </span>
          </label>
          <label className={styles.choice}>
            <input
              type="radio"
              name="extract-mode"
              checked={mode === 'perPage'}
              onChange={() => setMode('perPage')}
            />
            <span className={styles.choiceText}>
              One document per page
              <span className={styles.hint}>
                {`${String(pages.length)} file${pages.length === 1 ? '' : 's'} in a folder you choose.`}
              </span>
            </span>
          </label>
        </fieldset>

        <fieldset className={styles.group}>
          <legend className={styles.legend}>This document</legend>
          <label className={styles.choice}>
            <input
              type="checkbox"
              checked={deleteAfter && !keepsNothing}
              disabled={keepsNothing}
              onChange={(event) => setDeleteAfter(event.target.checked)}
            />
            <span className={styles.choiceText}>
              Remove the pages afterwards
              <span className={styles.hint}>
                {keepsNothing
                  ? 'Not possible here: a document must keep at least one page.'
                  : 'Only once the new files are written. Undo brings the pages back.'}
              </span>
            </span>
          </label>
        </fieldset>

        <p className={styles.summary}>
          The pages are copied. This document is not saved by extracting from it.
        </p>
      </div>
    </Dialog>
  );
}
