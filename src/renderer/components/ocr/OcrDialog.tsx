import { useEffect, useState, type ReactElement } from 'react';
import { OCR_DPI_CHOICES } from '@shared/schemas/ocr';
import { parsePageRange } from '@shared/utils/pageRange';
import { Button } from '../controls/Button';
import { Dialog } from '../overlays/Dialog';
import { useDocumentStore } from '../../stores/documentStore';
import { useOcrStore } from '../../stores/ocrStore';
import { usePdfDocumentContext } from '../viewer/pdfDocumentContextValue';
import styles from '../overlays/dialogForm.module.css';

type Scope = 'all' | 'current' | 'range';

/**
 * Recognize Text: reading a scan so its words can be found.
 *
 * Everything happens on this computer. The dialog says where Tesseract is and
 * what languages it has before it offers to read anything, because a tool
 * that is not installed should say so rather than fail halfway through.
 */
export function OcrDialog({ onClose }: { onClose: () => void }): ReactElement {
  const tab = useDocumentStore(
    (store) => store.tabs.find((entry) => entry.session.id === store.activeId) ?? null,
  );
  const { document } = usePdfDocumentContext();

  const status = useOcrStore((store) => store.status);
  const options = useOcrStore((store) => store.options);
  const progress = useOcrStore((store) => store.progress);
  const outcome = useOcrStore((store) => store.outcome);
  const busy = useOcrStore((store) => store.busy);

  // What PaperForge can do is worth knowing before anything is offered, so
  // the dialog asks as soon as it opens.
  useEffect(() => {
    useOcrStore.getState().forgetOutcome();
    void useOcrStore.getState().refreshStatus();
  }, []);

  const [scope, setScope] = useState<Scope>('all');
  const [rangeText, setRangeText] = useState('');
  const [searchable, setSearchable] = useState(true);

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

  const ready = status?.available === true && options.languages.length > 0;
  const problem =
    status === null
      ? 'Looking for Tesseract…'
      : !status.available
        ? status.problem
        : options.languages.length === 0
          ? 'Choose a language to read in.'
          : pages.length === 0
            ? 'Choose the pages to read.'
            : null;

  const start = (): void => {
    if (tab === null || document === null) return;
    void useOcrStore.getState().run({ sessionId: tab.session.id, document, pages, searchable });
  };

  return (
    <Dialog
      title="Recognize Text"
      description="Reads the words on a scanned page so they can be searched, selected and copied. It all happens on this computer: nothing is uploaded."
      onClose={onClose}
      footer={
        <>
          {outcome !== null && outcome.text.trim() !== '' && (
            <Button onClick={() => void useOcrStore.getState().saveText()}>Save the text</Button>
          )}
          {busy ? (
            <Button onClick={() => useOcrStore.getState().cancel()}>Stop</Button>
          ) : (
            <Button onClick={onClose}>Close</Button>
          )}
          <Button
            appearance="primary"
            onClick={start}
            disabled={busy || !ready || problem !== null}
          >
            {outcome === null ? 'Recognize' : 'Recognize again'}
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        {progress !== null && (
          <p className={styles.summary} aria-live="polite">
            {`Reading page ${String(progress.page)} — ${String(progress.done)} of ${String(progress.total)} done.`}
          </p>
        )}

        {outcome !== null && (
          <p className={styles.summary} aria-live="polite">
            {outcome.words === 0
              ? 'Nothing was read from those pages. A page with no writing on it, or a picture too faint to read, comes back empty.'
              : `${String(outcome.words)} words on ${String(outcome.pages)} page${
                  outcome.pages === 1 ? '' : 's'
                }${
                  outcome.confidence === null
                    ? ''
                    : `, read with ${String(outcome.confidence)}% confidence`
                }.${outcome.cancelled ? ' The run was stopped; what was read has been kept.' : ''}`}
          </p>
        )}

        <fieldset className={styles.group}>
          <legend className={styles.legend}>Tesseract</legend>
          {status === null ? (
            <p className={styles.hint}>Looking…</p>
          ) : (
            <>
              <p className={styles.summary}>
                {status.available
                  ? `${status.version ?? 'Tesseract'} — ${status.path ?? ''}`
                  : (status.problem ?? 'Not found.')}
              </p>
              <div className={styles.row}>
                <Button onClick={() => void useOcrStore.getState().locate()}>
                  Choose the program
                </Button>
                <Button onClick={() => void useOcrStore.getState().locateLanguages()}>
                  Choose the language data
                </Button>
                {status.path !== null && (
                  <Button onClick={() => void useOcrStore.getState().locate(true)}>
                    Look again
                  </Button>
                )}
              </div>
              {status.tessdataPath !== null && (
                <p className={styles.hint}>{`Language data: ${status.tessdataPath}`}</p>
              )}
            </>
          )}
        </fieldset>

        {status !== null && status.languages.length > 0 && (
          <fieldset className={styles.group}>
            <legend className={styles.legend}>Language</legend>
            <div className={styles.row}>
              <select
                className={styles.select}
                aria-label="Language"
                multiple={false}
                value={options.languages[0] ?? ''}
                onChange={(event) =>
                  useOcrStore.getState().setOptions({ languages: [event.target.value] })
                }
              >
                {status.languages
                  .filter((language) => language !== 'osd')
                  .map((language) => (
                    <option key={language} value={language}>
                      {language}
                    </option>
                  ))}
              </select>
              <span className={styles.hint}>
                Language packs are folders of files on this computer; PaperForge downloads none.
              </span>
            </div>
          </fieldset>
        )}

        <fieldset className={styles.group}>
          <legend className={styles.legend}>Pages</legend>
          <label className={styles.choice}>
            <input
              type="radio"
              name="ocr-scope"
              checked={scope === 'all'}
              onChange={() => setScope('all')}
            />
            <span className={styles.choiceText}>{`All ${String(pageCount)} pages`}</span>
          </label>
          <label className={styles.choice}>
            <input
              type="radio"
              name="ocr-scope"
              checked={scope === 'current'}
              onChange={() => setScope('current')}
            />
            <span className={styles.choiceText}>{`This page (${String(currentPage)})`}</span>
          </label>
          <div className={styles.block}>
            <label className={styles.choice}>
              <input
                type="radio"
                name="ocr-scope"
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

        <fieldset className={styles.group}>
          <legend className={styles.legend}>How to read them</legend>
          <div className={styles.row}>
            <label className={styles.label} htmlFor="ocr-dpi">
              Resolution
            </label>
            <select
              id="ocr-dpi"
              className={styles.select}
              value={options.dpi}
              onChange={(event) =>
                useOcrStore.getState().setOptions({ dpi: Number(event.target.value) })
              }
            >
              {OCR_DPI_CHOICES.map((dpi) => (
                <option key={dpi} value={dpi}>
                  {`${String(dpi)} dpi${dpi === 300 ? ' (usual)' : ''}`}
                </option>
              ))}
            </select>
          </div>
          <label className={styles.choice}>
            <input
              type="checkbox"
              checked={options.preprocess}
              onChange={(event) =>
                useOcrStore.getState().setOptions({ preprocess: event.target.checked })
              }
            />
            <span className={styles.choiceText}>
              Clean the picture up first
              <span className={styles.hint}>
                Greys it and lifts its contrast, which helps a photographed page. The document
                itself is never changed.
              </span>
            </span>
          </label>
          <label className={styles.choice}>
            <input
              type="checkbox"
              checked={searchable}
              onChange={(event) => setSearchable(event.target.checked)}
            />
            <span className={styles.choiceText}>
              Put the words into the document
              <span className={styles.hint}>
                Invisibly, over the picture that is already there, so the page still looks like a
                scan. Turn this off to read the words out without changing anything.
              </span>
            </span>
          </label>
        </fieldset>

        {problem !== null && !busy && <p className={styles.problem}>{problem}</p>}
      </div>
    </Dialog>
  );
}
