import { useEffect, useState, type ReactElement } from 'react';
import type { PrintOrientation, PrintSubset } from '@shared/schemas/print';
import { selectPrintPages, type PrintScope } from '@shared/utils/printPages';
import { Button } from '../controls/Button';
import { Dialog } from '../overlays/Dialog';
import { useDocumentStore } from '../../stores/documentStore';
import { usePrintStore } from '../../stores/printStore';
import { useUiStore } from '../../stores/uiStore';
import { usePdfDocumentContext } from '../viewer/pdfDocumentContextValue';
import styles from '../overlays/dialogForm.module.css';

/** The value the printer select uses for "whatever Windows prints to". */
const DEFAULT_PRINTER = '';

/**
 * Print: which pages, on which printer, and how they sit on the paper.
 *
 * Everything here is applied by PaperForge itself. Settings that belong to
 * the printer driver — paper trays, both sides, finishing — are in the
 * Windows print dialog, which "Choose more in the Windows print dialog" shows
 * before the job is sent.
 */
export function PrintDialog({ onClose }: { onClose: () => void }): ReactElement {
  const tab = useDocumentStore(
    (store) => store.tabs.find((entry) => entry.session.id === store.activeId) ?? null,
  );
  const { document } = usePdfDocumentContext();

  const settings = usePrintStore((store) => store.settings);
  const printers = usePrintStore((store) => store.printers);
  const progress = usePrintStore((store) => store.progress);
  const busy = usePrintStore((store) => store.busy);
  const set = usePrintStore.getState().setSettings;

  const [scope, setScope] = useState<PrintScope>('all');
  const [rangeText, setRangeText] = useState('');
  const [subset, setSubset] = useState<PrintSubset>('all');

  useEffect(() => {
    void usePrintStore.getState().loadPrinters();
  }, []);

  const pageCount = tab?.pageCount ?? 0;
  const currentPage = tab?.view.pageNumber ?? 1;
  const selection = selectPrintPages({ scope, rangeText, subset, currentPage, pageCount });
  const pages = selection.kind === 'pages' ? selection.pages : [];

  const print = async (): Promise<void> => {
    if (tab === null || document === null || pages.length === 0) return;
    const printed = await usePrintStore
      .getState()
      .run({ sessionId: tab.session.id, document, pages });
    if (!printed) return;

    const printer =
      printers?.find((entry) => entry.name === settings.deviceName)?.displayName ?? null;
    useUiStore.getState().showToast({
      title: `Sent ${String(pages.length)} page${pages.length === 1 ? '' : 's'} to the printer`,
      description: settings.useSystemDialog ? undefined : (printer ?? 'The default printer'),
      intent: 'success',
    });
    onClose();
  };

  return (
    <Dialog
      title="Print"
      description="Prints on this computer's printers. Nothing leaves the computer except to the printer."
      onClose={onClose}
      footer={
        <>
          {busy ? (
            <Button onClick={() => usePrintStore.getState().cancel()}>Stop</Button>
          ) : (
            <Button onClick={onClose}>Cancel</Button>
          )}
          <Button
            appearance="primary"
            onClick={() => void print()}
            disabled={busy || pages.length === 0 || document === null}
          >
            {settings.useSystemDialog ? 'Continue…' : 'Print'}
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        {progress !== null && (
          <p className={styles.summary} aria-live="polite">
            {`Preparing pages — ${String(progress.done)} of ${String(progress.total)} done.`}
          </p>
        )}

        <fieldset className={styles.group}>
          <legend className={styles.legend}>Printer</legend>
          <div className={styles.row}>
            <select
              className={`${styles.select} ${styles.grow}`}
              aria-label="Printer"
              value={settings.deviceName ?? DEFAULT_PRINTER}
              disabled={settings.useSystemDialog}
              onChange={(event) =>
                set({
                  deviceName: event.target.value === DEFAULT_PRINTER ? null : event.target.value,
                })
              }
            >
              <option value={DEFAULT_PRINTER}>The Windows default printer</option>
              {(printers ?? []).map((printer) => (
                <option key={printer.name} value={printer.name}>
                  {printer.isDefault ? `${printer.displayName} (default)` : printer.displayName}
                </option>
              ))}
            </select>
          </div>
          {printers !== null && printers.length === 0 && (
            <p className={styles.hint}>Windows reported no printers.</p>
          )}
          <label className={styles.choice}>
            <input
              type="checkbox"
              checked={settings.useSystemDialog}
              onChange={(event) => set({ useSystemDialog: event.target.checked })}
            />
            <span className={styles.choiceText}>
              Choose more in the Windows print dialog
              <span className={styles.hint}>
                Pick the printer, paper and both-sided printing there. The page settings below still
                apply.
              </span>
            </span>
          </label>
        </fieldset>

        <fieldset className={styles.group}>
          <legend className={styles.legend}>Pages</legend>
          <label className={styles.choice}>
            <input
              type="radio"
              name="print-scope"
              checked={scope === 'all'}
              onChange={() => setScope('all')}
            />
            <span className={styles.choiceText}>{`All ${String(pageCount)} pages`}</span>
          </label>
          <label className={styles.choice}>
            <input
              type="radio"
              name="print-scope"
              checked={scope === 'current'}
              onChange={() => setScope('current')}
            />
            <span className={styles.choiceText}>{`This page (${String(currentPage)})`}</span>
          </label>
          <div className={styles.block}>
            <label className={styles.choice}>
              <input
                type="radio"
                name="print-scope"
                checked={scope === 'range'}
                onChange={() => setScope('range')}
              />
              Pages
            </label>
            <div className={styles.blockBody}>
              <input
                type="text"
                className={styles.input}
                placeholder="1-4, 9"
                aria-label="Pages to print"
                value={rangeText}
                onFocus={() => setScope('range')}
                onChange={(event) => setRangeText(event.target.value)}
              />
            </div>
          </div>
          <div className={styles.row}>
            <label className={styles.label} htmlFor="print-subset">
              Print
            </label>
            <select
              id="print-subset"
              className={styles.select}
              value={subset}
              onChange={(event) => setSubset(event.target.value as PrintSubset)}
            >
              <option value="all">All pages in the range</option>
              <option value="odd">Odd pages only</option>
              <option value="even">Even pages only</option>
            </select>
          </div>
          {selection.kind === 'invalid' && <p className={styles.problem}>{selection.message}</p>}
        </fieldset>

        <fieldset className={styles.group}>
          <legend className={styles.legend}>Copies</legend>
          <div className={styles.row}>
            <label className={styles.label} htmlFor="print-copies">
              Copies
            </label>
            <input
              id="print-copies"
              type="number"
              className={styles.number}
              min={1}
              max={999}
              value={settings.copies}
              onChange={(event) => set({ copies: clamp(event.target.valueAsNumber, 1, 999) })}
            />
            <label className={styles.choice}>
              <input
                type="checkbox"
                checked={settings.collate}
                disabled={settings.copies === 1}
                onChange={(event) => set({ collate: event.target.checked })}
              />
              Collate
            </label>
          </div>
        </fieldset>

        <fieldset className={styles.group}>
          <legend className={styles.legend}>Page size and handling</legend>
          <label className={styles.choice}>
            <input
              type="radio"
              name="print-scale"
              checked={settings.scale === 'fit'}
              onChange={() => set({ scale: 'fit' })}
            />
            <span className={styles.choiceText}>Fit to the paper</span>
          </label>
          <label className={styles.choice}>
            <input
              type="radio"
              name="print-scale"
              checked={settings.scale === 'actual'}
              onChange={() => set({ scale: 'actual' })}
            />
            <span className={styles.choiceText}>
              Actual size
              <span className={styles.hint}>A page larger than the paper is cut off.</span>
            </span>
          </label>
          <div className={styles.row}>
            <label className={styles.choice}>
              <input
                type="radio"
                name="print-scale"
                checked={settings.scale === 'custom'}
                onChange={() => set({ scale: 'custom' })}
              />
              Custom scale
            </label>
            <input
              type="number"
              className={styles.number}
              aria-label="Custom scale, percent"
              min={10}
              max={400}
              value={settings.customScale}
              onFocus={() => set({ scale: 'custom' })}
              onChange={(event) => set({ customScale: clamp(event.target.valueAsNumber, 10, 400) })}
            />
            <span className={styles.hint}>%</span>
          </div>
          <div className={styles.row}>
            <label className={styles.label} htmlFor="print-orientation">
              Orientation
            </label>
            <select
              id="print-orientation"
              className={styles.select}
              value={settings.orientation}
              onChange={(event) => set({ orientation: event.target.value as PrintOrientation })}
            >
              <option value="auto">Follow the pages</option>
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
            </select>
          </div>
          <label className={styles.choice}>
            <input
              type="checkbox"
              checked={settings.autoRotate}
              onChange={(event) => set({ autoRotate: event.target.checked })}
            />
            <span className={styles.choiceText}>
              Turn pages to match the paper
              <span className={styles.hint}>
                A wide page on tall paper is printed on its side, so it is not shrunk.
              </span>
            </span>
          </label>
          <label className={styles.choice}>
            <input
              type="checkbox"
              checked={settings.center}
              onChange={(event) => set({ center: event.target.checked })}
            />
            <span className={styles.choiceText}>Centre each page on the paper</span>
          </label>
        </fieldset>

        <fieldset className={styles.group}>
          <legend className={styles.legend}>What to print</legend>
          <label className={styles.choice}>
            <input
              type="checkbox"
              checked={settings.annotations}
              onChange={(event) => set({ annotations: event.target.checked })}
            />
            <span className={styles.choiceText}>
              Comments, stamps and form fields
              <span className={styles.hint}>
                Anything the document marks as not for printing is left out either way.
              </span>
            </span>
          </label>
          <label className={styles.choice}>
            <input
              type="checkbox"
              checked={!settings.color}
              onChange={(event) => set({ color: !event.target.checked })}
            />
            <span className={styles.choiceText}>Print in shades of grey</span>
          </label>
          <div className={styles.row}>
            <label className={styles.label} htmlFor="print-quality">
              Quality
            </label>
            <select
              id="print-quality"
              className={styles.select}
              value={settings.quality}
              onChange={(event) =>
                set({ quality: event.target.value === 'high' ? 'high' : 'standard' })
              }
            >
              <option value="standard">Standard (150 dpi)</option>
              <option value="high">High (300 dpi, slower)</option>
            </select>
          </div>
        </fieldset>

        {pages.length > 0 && (
          <p className={styles.hint} aria-live="polite">
            {`${String(pages.length)} page${pages.length === 1 ? '' : 's'}${
              settings.copies > 1 ? `, ${String(settings.copies)} copies of each` : ''
            }.`}
          </p>
        )}
      </div>
    </Dialog>
  );
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}
