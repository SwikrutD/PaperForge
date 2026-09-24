import { useState, type ReactElement } from 'react';
import type { BackgroundSettings } from '@shared/schemas/furniture';
import { Button } from '../../controls/Button';
import { Dialog } from '../../overlays/Dialog';
import { useDocumentStore } from '../../../stores/documentStore';
import { PageScopeField } from './PageScopeField';
import { pagesForScope, type PageScope } from './pageScope';
import { useStagedImage } from './useStagedImage';
import { hexOf, rgbOf } from './furnitureValues';
import styles from '../../overlays/dialogForm.module.css';
import own from './furniture.module.css';

const FITS = [
  { id: 'fill', label: 'Fill the page', hint: 'Covers it; the edges of the image may be cut off.' },
  { id: 'fit', label: 'Fit the page', hint: 'Shows all of it, centred.' },
  { id: 'tile', label: 'Tile', hint: 'Repeats it across the page.' },
] as const;

/**
 * Background: a colour or a picture drawn under everything the page draws.
 *
 * Like a watermark it is marked as PaperForge's own, so a second one replaces
 * the first and Remove takes it off cleanly.
 */
export function BackgroundDialog({ onClose }: { onClose: () => void }): ReactElement {
  const tab = useDocumentStore(
    (store) => store.tabs.find((entry) => entry.session.id === store.activeId) ?? null,
  );
  const [scope, setScope] = useState<PageScope>('all');
  const [rangeText, setRangeText] = useState('');
  const [color, setColor] = useState({ r: 0.97, g: 0.95, b: 0.86 });
  const [fit, setFit] = useState<'fill' | 'fit' | 'tile'>('fill');
  const [opacity, setOpacity] = useState(1);
  const [busy, setBusy] = useState(false);
  const image = useStagedImage();

  const pageCount = tab?.pageCount ?? 0;
  const currentPage = tab?.view.pageNumber ?? 1;
  const pages = pagesForScope(scope, rangeText, pageCount, currentPage);
  const sessionId = tab?.session.id ?? null;

  const problem =
    pages.length === 0
      ? 'Choose the pages to put the background on.'
      : image.kind === 'image' && image.staged === null
        ? 'Choose the image to use.'
        : null;

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
    const background: BackgroundSettings = {
      fill:
        image.kind === 'image' && image.staged !== null
          ? { kind: 'image', token: image.staged.token, fit }
          : { kind: 'color', color },
      opacity,
    };
    void run({ label: 'Background', operations: [{ kind: 'setBackground', pages, background }] });
  };

  const remove = (): void => {
    void run({
      label: 'Remove background',
      operations: [{ kind: 'removeFurniture', pages, kinds: ['background'] }],
    });
  };

  return (
    <Dialog
      title="Background"
      description="Drawn under everything the page draws, and marked as PaperForge's own so it can be changed or taken off again."
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
        <fieldset className={styles.group}>
          <legend className={styles.legend}>What to draw</legend>
          <div className={styles.row}>
            <label className={styles.choice}>
              <input
                type="radio"
                name="background-source"
                checked={image.kind === 'text'}
                onChange={() => image.setKind('text')}
              />
              A colour
            </label>
            <label className={styles.choice}>
              <input
                type="radio"
                name="background-source"
                checked={image.kind === 'image'}
                onChange={() => image.setKind('image')}
              />
              An image
            </label>
          </div>

          {image.kind === 'text' ? (
            <div className={styles.row}>
              <label className={styles.label} htmlFor="background-colour">
                Colour
              </label>
              <input
                id="background-colour"
                type="color"
                className={own.picker}
                value={hexOf(color)}
                onChange={(event) => setColor(rgbOf(event.target.value))}
              />
            </div>
          ) : (
            <>
              <div className={styles.row}>
                <Button onClick={() => void image.choose()} disabled={busy}>
                  Choose image
                </Button>
                <span className={styles.hint}>
                  {image.staged?.fileName ?? 'No image chosen yet.'}
                </span>
              </div>
              {FITS.map((entry) => (
                <label className={styles.choice} key={entry.id}>
                  <input
                    type="radio"
                    name="background-fit"
                    checked={fit === entry.id}
                    onChange={() => setFit(entry.id)}
                  />
                  <span className={styles.choiceText}>
                    {entry.label}
                    <span className={styles.hint}>{entry.hint}</span>
                  </span>
                </label>
              ))}
            </>
          )}

          <div className={styles.row}>
            <label className={styles.label} htmlFor="background-opacity">
              Opacity
            </label>
            <input
              id="background-opacity"
              type="range"
              min={5}
              max={100}
              value={Math.round(opacity * 100)}
              onChange={(event) => setOpacity(Number(event.target.value) / 100)}
            />
            <span className={styles.hint}>{`${String(Math.round(opacity * 100))}%`}</span>
          </div>
        </fieldset>

        <PageScopeField
          name="background-scope"
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
