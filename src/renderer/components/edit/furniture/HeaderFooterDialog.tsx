import { useState, type ReactElement } from 'react';
import type { FurnitureLine, HeaderFooterSettings } from '@shared/schemas/furniture';
import { DEFAULT_TEXT_STYLE, type TextFamily } from '@shared/schemas/text';
import { Button } from '../../controls/Button';
import { Dialog } from '../../overlays/Dialog';
import { useDocumentStore } from '../../../stores/documentStore';
import { PageScopeField } from './PageScopeField';
import { pagesForScope, type PageScope } from './pageScope';
import { hexOf, rgbOf } from './furnitureValues';
import styles from '../../overlays/dialogForm.module.css';
import own from './furniture.module.css';

const PLACES = [
  { id: 'left', label: 'Left' },
  { id: 'center', label: 'Centre' },
  { id: 'right', label: 'Right' },
] as const;

const TOKENS = [
  { token: '{{page}}', hint: 'The page number' },
  { token: '{{pages}}', hint: 'How many pages' },
  { token: '{{date}}', hint: "Today's date" },
  { token: '{{title}}', hint: 'The document title' },
  { token: '{{bates}}', hint: 'The Bates number' },
];

const EMPTY: FurnitureLine = { left: '', center: '', right: '' };

/**
 * Headers, footers and Bates numbering.
 *
 * The lines are written with tokens rather than numbers, so `{{page}}` means
 * the page it lands on. The preview shows what the first page in the range
 * will say — the words themselves, not a picture of the page.
 */
export function HeaderFooterDialog({ onClose }: { onClose: () => void }): ReactElement {
  const tab = useDocumentStore(
    (store) => store.tabs.find((entry) => entry.session.id === store.activeId) ?? null,
  );
  const [scope, setScope] = useState<PageScope>('all');
  const [rangeText, setRangeText] = useState('');
  const [header, setHeader] = useState<FurnitureLine>(EMPTY);
  const [footer, setFooter] = useState<FurnitureLine>({
    ...EMPTY,
    center: 'Page {{page}} of {{pages}}',
  });
  const [style, setStyle] = useState({ ...DEFAULT_TEXT_STYLE, size: 10 });
  const [margin, setMargin] = useState(36);
  const [startNumber, setStartNumber] = useState(1);
  const [bates, setBates] = useState({ prefix: '', suffix: '', digits: 6, start: 1 });
  const [numbering, setNumbering] = useState(false);
  const [focused, setFocused] = useState<{ line: 'header' | 'footer'; place: keyof FurnitureLine }>(
    { line: 'footer', place: 'center' },
  );
  const [busy, setBusy] = useState(false);

  const pageCount = tab?.pageCount ?? 0;
  const currentPage = tab?.view.pageNumber ?? 1;
  const pages = pagesForScope(scope, rangeText, pageCount, currentPage);
  const sessionId = tab?.session.id ?? null;
  const title = tab?.session.file.displayName ?? '';
  const date = new Date().toLocaleDateString();

  const empty = [header, footer].every((line) =>
    Object.values(line).every((value) => value.trim() === ''),
  );
  const problem =
    pages.length === 0
      ? 'Choose the pages to put the header and footer on.'
      : empty
        ? 'Type something for at least one of the six places.'
        : null;

  const settings = (): HeaderFooterSettings => ({
    header,
    footer,
    style,
    margin,
    startNumber,
    bates: numbering ? bates : null,
    date,
    title,
  });

  const run = async (
    transaction: Parameters<ReturnType<typeof useDocumentStore.getState>['applyEdit']>[1],
  ): Promise<void> => {
    if (sessionId === null) return;
    setBusy(true);
    try {
      await useDocumentStore.getState().applyEdit(sessionId, transaction);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const apply = (): void => {
    void run({
      label: 'Header and footer',
      operations: [{ kind: 'setHeaderFooter', pages, settings: settings() }],
    });
  };

  const remove = (): void => {
    void run({
      label: 'Remove header and footer',
      operations: [{ kind: 'removeFurniture', pages, kinds: ['header', 'footer'] }],
    });
  };

  const setLine = (line: 'header' | 'footer', place: keyof FurnitureLine, value: string): void => {
    const update = line === 'header' ? setHeader : setFooter;
    const current = line === 'header' ? header : footer;
    update({ ...current, [place]: value });
  };

  /** Puts a token where the cursor last was, which is what a reader expects. */
  const addToken = (token: string): void => {
    const current = focused.line === 'header' ? header : footer;
    setLine(focused.line, focused.place, `${current[focused.place]}${token}`);
  };

  const preview = (line: FurnitureLine): FurnitureLine => ({
    left: resolve(line.left),
    center: resolve(line.center),
    right: resolve(line.right),
  });

  const resolve = (value: string): string =>
    value
      .replaceAll('{{page}}', String(startNumber))
      .replaceAll('{{pages}}', String(pages.length))
      .replaceAll('{{date}}', date)
      .replaceAll('{{title}}', title)
      .replaceAll(
        '{{bates}}',
        numbering
          ? `${bates.prefix}${String(bates.start).padStart(bates.digits, '0')}${bates.suffix}`
          : '',
      );

  return (
    <Dialog
      title="Header and Footer"
      description="Written with tokens, so one line serves every page. PaperForge marks what it adds, so it can be changed or taken off again."
      onClose={onClose}
      footer={
        <>
          <Button onClick={remove} disabled={busy || pages.length === 0}>
            Remove
          </Button>
          <Button onClick={onClose}>Cancel</Button>
          <Button appearance="primary" onClick={apply} disabled={busy || problem !== null}>
            Apply
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        {(['header', 'footer'] as const).map((line) => (
          <fieldset className={styles.group} key={line}>
            <legend className={styles.legend}>{line === 'header' ? 'Header' : 'Footer'}</legend>
            <div className={own.lines}>
              {PLACES.map((place) => (
                <label className={own.lineField} key={place.id}>
                  {place.label}
                  <input
                    type="text"
                    className={styles.input}
                    value={(line === 'header' ? header : footer)[place.id]}
                    maxLength={200}
                    onFocus={() => setFocused({ line, place: place.id })}
                    onChange={(event) => setLine(line, place.id, event.target.value)}
                  />
                </label>
              ))}
            </div>
          </fieldset>
        ))}

        <fieldset className={styles.group}>
          <legend className={styles.legend}>Tokens</legend>
          <div className={own.tokens}>
            {TOKENS.map((entry) => (
              <button
                key={entry.token}
                type="button"
                className={own.token}
                title={entry.hint}
                onClick={() => addToken(entry.token)}
              >
                {entry.token}
              </button>
            ))}
          </div>
          <p className={styles.hint}>
            A token is replaced page by page. The last box you typed in is where a token goes.
          </p>
        </fieldset>

        <fieldset className={styles.group}>
          <legend className={styles.legend}>How it looks</legend>
          <div className={styles.row}>
            <label className={styles.label} htmlFor="furniture-font">
              Font
            </label>
            <select
              id="furniture-font"
              className={styles.select}
              value={style.family}
              onChange={(event) => setStyle({ ...style, family: event.target.value as TextFamily })}
            >
              <option value="helvetica">Helvetica</option>
              <option value="times">Times</option>
              <option value="courier">Courier</option>
            </select>
            <input
              type="number"
              className={`${styles.input} ${styles.number}`}
              aria-label="Font size"
              min={5}
              max={72}
              value={style.size}
              onChange={(event) =>
                setStyle({ ...style, size: Math.max(5, Number(event.target.value) || 5) })
              }
            />
            <input
              type="color"
              className={own.picker}
              aria-label="Text colour"
              value={hexOf(style.color)}
              onChange={(event) => setStyle({ ...style, color: rgbOf(event.target.value) })}
            />
          </div>
          <div className={styles.row}>
            <label className={styles.label} htmlFor="furniture-margin">
              Margin
            </label>
            <input
              id="furniture-margin"
              type="number"
              className={`${styles.input} ${styles.number}`}
              min={0}
              max={300}
              value={margin}
              onChange={(event) => setMargin(Math.max(0, Number(event.target.value) || 0))}
            />
            <label className={styles.label} htmlFor="furniture-start">
              {'{{page}} starts at'}
            </label>
            <input
              id="furniture-start"
              type="number"
              className={`${styles.input} ${styles.number}`}
              min={0}
              max={1000000}
              value={startNumber}
              onChange={(event) => setStartNumber(Math.max(0, Number(event.target.value) || 0))}
            />
          </div>
        </fieldset>

        <fieldset className={styles.group}>
          <legend className={styles.legend}>Bates numbering</legend>
          <label className={styles.choice}>
            <input
              type="checkbox"
              checked={numbering}
              onChange={(event) => setNumbering(event.target.checked)}
            />
            Number the pages with {'{{bates}}'}
          </label>
          {numbering && (
            <div className={styles.row}>
              <input
                type="text"
                className={`${styles.input} ${styles.number}`}
                aria-label="Bates prefix"
                placeholder="Prefix"
                maxLength={40}
                value={bates.prefix}
                onChange={(event) => setBates({ ...bates, prefix: event.target.value })}
              />
              <input
                type="number"
                className={`${styles.input} ${styles.number}`}
                aria-label="Bates start"
                min={0}
                value={bates.start}
                onChange={(event) =>
                  setBates({ ...bates, start: Math.max(0, Number(event.target.value) || 0) })
                }
              />
              <input
                type="number"
                className={`${styles.input} ${styles.number}`}
                aria-label="Bates digits"
                min={1}
                max={12}
                value={bates.digits}
                onChange={(event) =>
                  setBates({
                    ...bates,
                    digits: Math.min(12, Math.max(1, Number(event.target.value) || 1)),
                  })
                }
              />
              <input
                type="text"
                className={`${styles.input} ${styles.number}`}
                aria-label="Bates suffix"
                placeholder="Suffix"
                maxLength={40}
                value={bates.suffix}
                onChange={(event) => setBates({ ...bates, suffix: event.target.value })}
              />
            </div>
          )}
        </fieldset>

        <fieldset className={styles.group} aria-label="Preview">
          <legend className={styles.legend}>Preview of the first page</legend>
          {(['header', 'footer'] as const).map((line) => {
            const resolved = preview(line === 'header' ? header : footer);
            return (
              <p className={own.sample} key={line}>
                <span>{resolved.left}</span>
                <span className={own.sampleCenter}>{resolved.center}</span>
                <span className={own.sampleRight}>{resolved.right}</span>
              </p>
            );
          })}
        </fieldset>

        <PageScopeField
          name="furniture-scope"
          scope={scope}
          rangeText={rangeText}
          pageCount={pageCount}
          currentPage={currentPage}
          onScope={setScope}
          onRangeText={setRangeText}
        />

        {problem !== null && <p className={styles.problem}>{problem}</p>}
      </div>
    </Dialog>
  );
}
