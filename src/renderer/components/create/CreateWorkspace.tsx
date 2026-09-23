import { useEffect, useState, type ReactElement } from 'react';
import { FilePlus2, FileStack, Plus, Trash2, X } from 'lucide-react';
import { Button } from '../controls/Button';
import { ErrorMessageBar } from '../surfaces/MessageBar';
import { plannedPageCount, problemOf, useCreateStore } from '../../stores/createStore';
import { BlankDocumentDialog } from './BlankDocumentDialog';
import { CreateOptions } from './CreateOptions';
import { SourceList } from './SourceList';
import styles from './CreateWorkspace.module.css';

/**
 * Making a new document out of local files.
 *
 * The same workspace answers both "create a PDF" and "combine files": the
 * difference is only what the reader came in for, and what it is called while
 * they are there. Nothing is written until they say where it goes, and the
 * files they added are never touched.
 */
export function CreateWorkspace(): ReactElement {
  const intent = useCreateStore((state) => state.intent);
  const entries = useCreateStore((state) => state.entries);
  const failures = useCreateStore((state) => state.failures);
  const busy = useCreateStore((state) => state.busy);
  const addFiles = useCreateStore((state) => state.addFiles);
  const clear = useCreateStore((state) => state.clear);
  const combine = useCreateStore((state) => state.combine);
  const close = useCreateStore((state) => state.closeWorkspace);
  const openWorkspace = useCreateStore((state) => state.openWorkspace);
  const [blankOpen, setBlankOpen] = useState(false);

  // The list belongs to the window, so it is read again when the workspace is
  // shown: what was staged before is still staged.
  useEffect(() => {
    openWorkspace(intent);
    // Only on mount: re-reading on every change would fight the reader's order.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pages = plannedPageCount(entries);
  const problem = entries.some((entry) => problemOf(entry) !== null);
  const ready = entries.length > 0 && !problem && !busy;

  return (
    <div className={styles.workspace}>
      <div className={styles.bar} role="toolbar" aria-label="New document">
        <h2 className={styles.title}>{intent === 'combine' ? 'Combine Files' : 'Create PDF'}</h2>
        <p className={styles.count} aria-live="polite">
          {entries.length === 0
            ? 'No files yet'
            : `${String(entries.length)} file${entries.length === 1 ? '' : 's'} · ${String(pages)} page${pages === 1 ? '' : 's'}`}
        </p>

        <div className={styles.group}>
          <Button icon={Plus} onClick={() => void addFiles()} disabled={busy}>
            Add files…
          </Button>
          <Button icon={FilePlus2} onClick={() => setBlankOpen(true)} disabled={busy}>
            Blank document…
          </Button>
          <Button
            icon={Trash2}
            onClick={() => void clear()}
            disabled={busy || entries.length === 0}
          >
            Clear
          </Button>
        </div>

        <div className={styles.end}>
          <Button
            appearance="primary"
            icon={FileStack}
            onClick={() => void combine()}
            disabled={!ready}
            title={
              entries.length === 0
                ? 'Add the files to make the document from.'
                : problem
                  ? 'One of the page ranges is not a page range.'
                  : undefined
            }
          >
            {intent === 'combine' ? 'Combine…' : 'Create…'}
          </Button>
          <Button icon={X} onClick={close}>
            Close
          </Button>
        </div>
      </div>

      <div className={styles.body}>
        <div className={styles.main}>
          {failures.length > 0 && (
            <div className={styles.failures}>
              {failures.map((failure) => (
                <ErrorMessageBar
                  key={`${failure.fileName}:${failure.message}`}
                  error={{
                    code: 'conversion/provider-unavailable',
                    message: `${failure.fileName}: ${failure.message}`,
                    ...(failure.details === undefined ? {} : { details: failure.details }),
                  }}
                />
              ))}
            </div>
          )}

          {entries.length === 0 ? (
            <div className={styles.empty}>
              <FileStack className={styles.emptyIcon} aria-hidden="true" strokeWidth={1.3} />
              <h3 className={styles.emptyTitle}>Add the files to make a document from</h3>
              <p className={styles.emptyText}>
                PDFs, images, text files and local web pages. Each one becomes pages you can order,
                turn and take a range from — the files themselves are never changed.
              </p>
              <Button
                appearance="primary"
                icon={Plus}
                onClick={() => void addFiles()}
                disabled={busy}
              >
                Add files…
              </Button>
            </div>
          ) : (
            <SourceList entries={entries} />
          )}
        </div>

        <CreateOptions />
      </div>

      {blankOpen && <BlankDocumentDialog onClose={() => setBlankOpen(false)} />}
    </div>
  );
}
