import { useEffect, useState, type ReactElement } from 'react';
import {
  EXPORT_DESCRIPTIONS,
  EXPORT_DPI_CHOICES,
  exportNeedsImage,
  type ExportMode,
} from '@shared/schemas/convert';
import { parsePageRange } from '@shared/utils/pageRange';
import { Button } from '../controls/Button';
import { Dialog } from '../overlays/Dialog';
import { cx } from '../../utils/classNames';
import { useDocumentStore } from '../../stores/documentStore';
import { useExportStore } from '../../stores/exportStore';
import { usePdfDocumentContext } from '../viewer/pdfDocumentContextValue';
import styles from '../overlays/dialogForm.module.css';
import own from './export.module.css';

type Scope = 'all' | 'current' | 'range';

const MODES: Array<{ id: ExportMode; label: string }> = [
  { id: 'png', label: 'PNG images' },
  { id: 'jpeg', label: 'JPEG images' },
  { id: 'webp', label: 'WebP images' },
  { id: 'txt', label: 'Text' },
  { id: 'html', label: 'Web page' },
  { id: 'docx', label: 'Word' },
  { id: 'xlsx', label: 'Excel' },
  { id: 'pptx', label: 'PowerPoint' },
];

/**
 * Export: turning a document into something that is not a PDF.
 *
 * Every choice says what it carries and what it loses, because a conversion
 * that quietly drops a table is worse than one that warns it might. Nothing
 * here leaves the computer.
 */
export function ExportDialog({ onClose }: { onClose: () => void }): ReactElement {
  const tab = useDocumentStore(
    (store) => store.tabs.find((entry) => entry.session.id === store.activeId) ?? null,
  );
  const { document } = usePdfDocumentContext();

  const options = useExportStore((store) => store.options);
  const progress = useExportStore((store) => store.progress);
  const outcome = useExportStore((store) => store.outcome);
  const busy = useExportStore((store) => store.busy);

  const [scope, setScope] = useState<Scope>('all');
  const [rangeText, setRangeText] = useState('');

  useEffect(() => {
    useExportStore.getState().forgetOutcome();
  }, []);

  const pageCount = tab?.pageCount ?? 0;
  const currentPage = tab?.view.pageNumber ?? 1;
  const range = parsePageRange(rangeText, pageCount);
  const pages =
    scope === 'all'
      ? Array.from({ length: pageCount }, (_, index) => index + 1)
      : scope === 'current'
        ? [currentPage]
        : range.kind === 'pages'
          ? [...range.pages]
          : [];

  const pictures = options.mode === 'png' || options.mode === 'jpeg' || options.mode === 'webp';
  const lossy = options.mode === 'jpeg' || options.mode === 'webp';
  const needsImage = exportNeedsImage(options);

  const problem = pages.length === 0 ? 'Choose the pages to export.' : busy ? null : null;

  const start = (): void => {
    if (tab === null || document === null) return;
    void useExportStore.getState().run({ sessionId: tab.session.id, document, pages });
  };

  return (
    <Dialog
      title="Export"
      description="Turns this document into something that is not a PDF. Everything happens on this computer."
      onClose={onClose}
      footer={
        <>
          {outcome !== null && outcome.directory !== null && (
            <Button onClick={() => void useExportStore.getState().reveal()}>Open the folder</Button>
          )}
          {busy ? (
            <Button onClick={() => useExportStore.getState().cancel()}>Stop</Button>
          ) : (
            <Button onClick={onClose}>Close</Button>
          )}
          <Button appearance="primary" onClick={start} disabled={busy || problem !== null}>
            Export
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        {progress !== null && (
          <p className={styles.summary} aria-live="polite">
            {`Writing page ${String(progress.page)} — ${String(progress.done)} of ${String(
              progress.total,
            )} done.`}
          </p>
        )}

        {outcome !== null && (
          <p className={styles.summary} aria-live="polite">
            {outcome.cancelled
              ? `Stopped. ${String(outcome.files)} file${outcome.files === 1 ? '' : 's'} had already been written.`
              : `${String(outcome.files)} file${outcome.files === 1 ? '' : 's'} written${
                  outcome.directory === null ? '' : ` to ${outcome.directory}`
                }.`}
          </p>
        )}

        <fieldset className={styles.group}>
          <legend className={styles.legend}>What to write</legend>
          <div className={own.modes} role="radiogroup" aria-label="What to write">
            {MODES.map((mode) => (
              <button
                key={mode.id}
                type="button"
                role="radio"
                aria-checked={options.mode === mode.id}
                className={cx(own.mode, options.mode === mode.id && own.modeOn)}
                onClick={() => useExportStore.getState().setOptions({ mode: mode.id })}
              >
                {mode.label}
              </button>
            ))}
          </div>
          <p className={styles.hint}>{EXPORT_DESCRIPTIONS[options.mode]}</p>
        </fieldset>

        <fieldset className={styles.group}>
          <legend className={styles.legend}>Pages</legend>
          <label className={styles.choice}>
            <input
              type="radio"
              name="export-scope"
              checked={scope === 'all'}
              onChange={() => setScope('all')}
            />
            <span className={styles.choiceText}>{`All ${String(pageCount)} pages`}</span>
          </label>
          <label className={styles.choice}>
            <input
              type="radio"
              name="export-scope"
              checked={scope === 'current'}
              onChange={() => setScope('current')}
            />
            <span className={styles.choiceText}>{`This page (${String(currentPage)})`}</span>
          </label>
          <div className={styles.block}>
            <label className={styles.choice}>
              <input
                type="radio"
                name="export-scope"
                checked={scope === 'range'}
                onChange={() => setScope('range')}
              />
              A page range
            </label>
            <div className={styles.blockBody}>
              <input
                type="text"
                className={styles.input}
                placeholder="1-4, 9"
                aria-label="Page range"
                value={rangeText}
                onFocus={() => setScope('range')}
                onChange={(event) => setRangeText(event.target.value)}
              />
              {scope === 'range' && range.kind === 'invalid' && (
                <p className={styles.problem}>{range.message}</p>
              )}
            </div>
          </div>
        </fieldset>

        {needsImage && (
          <fieldset className={styles.group}>
            <legend className={styles.legend}>Pictures</legend>
            <div className={styles.row}>
              <label className={styles.label} htmlFor="export-dpi">
                Resolution
              </label>
              <select
                id="export-dpi"
                className={styles.select}
                value={options.dpi}
                onChange={(event) =>
                  useExportStore.getState().setOptions({ dpi: Number(event.target.value) })
                }
              >
                {EXPORT_DPI_CHOICES.map((dpi) => (
                  <option key={dpi} value={dpi}>
                    {`${String(dpi)} dpi${dpi === 150 ? ' (screen)' : dpi === 300 ? ' (print)' : ''}`}
                  </option>
                ))}
              </select>
            </div>

            {lossy && (
              <div className={styles.row}>
                <label className={styles.label} htmlFor="export-quality">
                  Quality
                </label>
                <input
                  id="export-quality"
                  type="range"
                  min={10}
                  max={100}
                  value={options.quality}
                  onChange={(event) =>
                    useExportStore.getState().setOptions({ quality: Number(event.target.value) })
                  }
                />
                <span className={styles.hint}>{`${String(options.quality)}%`}</span>
              </div>
            )}

            {options.mode === 'png' || options.mode === 'webp' ? (
              <label className={styles.choice}>
                <input
                  type="checkbox"
                  checked={options.transparent}
                  onChange={(event) =>
                    useExportStore.getState().setOptions({ transparent: event.target.checked })
                  }
                />
                <span className={styles.choiceText}>
                  Keep the page&rsquo;s own transparency
                  <span className={styles.hint}>
                    Most pages paint no background of their own, so this leaves them see-through
                    rather than white.
                  </span>
                </span>
              </label>
            ) : null}
          </fieldset>
        )}

        {pictures && (
          <fieldset className={styles.group}>
            <legend className={styles.legend}>Names</legend>
            <div className={styles.row}>
              <input
                type="text"
                className={`${styles.input} ${styles.grow}`}
                aria-label="File name template"
                value={options.naming}
                onChange={(event) =>
                  useExportStore.getState().setOptions({ naming: event.target.value })
                }
              />
            </div>
            <p className={styles.hint}>
              {'{name} is this document, {page} the page number, {n} a running count.'}
            </p>
          </fieldset>
        )}

        {options.mode === 'txt' && (
          <label className={styles.choice}>
            <input
              type="checkbox"
              checked={options.preserveLayout}
              onChange={(event) =>
                useExportStore.getState().setOptions({ preserveLayout: event.target.checked })
              }
            />
            <span className={styles.choiceText}>
              Keep the lines where they sit
              <span className={styles.hint}>
                Pads each line out with spaces, so a column of figures stays a column.
              </span>
            </span>
          </label>
        )}

        {options.mode === 'html' && (
          <label className={styles.choice}>
            <input
              type="checkbox"
              checked={options.includePageImages}
              onChange={(event) =>
                useExportStore.getState().setOptions({ includePageImages: event.target.checked })
              }
            />
            <span className={styles.choiceText}>
              Put a picture of each page underneath
              <span className={styles.hint}>
                The page looks as it does here, with its words selectable on top. Without it, the
                words are all that is written.
              </span>
            </span>
          </label>
        )}

        {options.mode === 'pptx' && (
          <fieldset className={styles.group}>
            <legend className={styles.legend}>Slides</legend>
            <label className={styles.choice}>
              <input
                type="radio"
                name="export-fidelity"
                checked={options.fidelity === 'layout'}
                onChange={() => useExportStore.getState().setOptions({ fidelity: 'layout' })}
              />
              <span className={styles.choiceText}>
                Best for layout
                <span className={styles.hint}>
                  Each slide is a picture of the page. It looks exactly right and none of it can be
                  edited.
                </span>
              </span>
            </label>
            <label className={styles.choice}>
              <input
                type="radio"
                name="export-fidelity"
                checked={options.fidelity === 'editable'}
                onChange={() => useExportStore.getState().setOptions({ fidelity: 'editable' })}
              />
              <span className={styles.choiceText}>
                Best for editing
                <span className={styles.hint}>
                  The words become text boxes. Complex layouts will change.
                </span>
              </span>
            </label>
          </fieldset>
        )}

        {problem !== null && !busy && <p className={styles.problem}>{problem}</p>}
      </div>
    </Dialog>
  );
}
