import { useState, type ReactElement } from 'react';
import type { WatermarkSettings } from '@shared/schemas/furniture';
import { DEFAULT_TEXT_STYLE, type TextFamily } from '@shared/schemas/text';
import { Button } from '../../controls/Button';
import { Dialog } from '../../overlays/Dialog';
import { useDocumentStore } from '../../../stores/documentStore';
import { PageScopeField } from './PageScopeField';
import { pagesForScope, type PageScope } from './pageScope';
import { useStagedImage } from './useStagedImage';
import { cssFamily, hexOf, rgbOf } from './furnitureValues';
import styles from '../../overlays/dialogForm.module.css';
import own from './furniture.module.css';

const FAMILIES: Array<{ id: TextFamily; label: string }> = [
  { id: 'helvetica', label: 'Helvetica' },
  { id: 'times', label: 'Times' },
  { id: 'courier', label: 'Courier' },
];

/**
 * Watermark: a word or a picture drawn over — or under — the whole page.
 *
 * PaperForge marks what it draws as its own, so applying a watermark to a
 * page that already carries one replaces it, and Remove takes it off and
 * leaves the page as it was.
 */
export function WatermarkDialog({ onClose }: { onClose: () => void }): ReactElement {
  const tab = useDocumentStore(
    (store) => store.tabs.find((entry) => entry.session.id === store.activeId) ?? null,
  );
  const [scope, setScope] = useState<PageScope>('all');
  const [rangeText, setRangeText] = useState('');
  const [text, setText] = useState('DRAFT');
  const [style, setStyle] = useState({ ...DEFAULT_TEXT_STYLE, size: 48 });
  const [opacity, setOpacity] = useState(0.25);
  const [rotation, setRotation] = useState(45);
  const [scale, setScale] = useState(1);
  const [behind, setBehind] = useState(false);
  const [busy, setBusy] = useState(false);
  const image = useStagedImage();

  const pageCount = tab?.pageCount ?? 0;
  const currentPage = tab?.view.pageNumber ?? 1;
  const pages = pagesForScope(scope, rangeText, pageCount, currentPage);
  const sessionId = tab?.session.id ?? null;

  const problem =
    pages.length === 0
      ? 'Choose the pages to put the watermark on.'
      : image.kind === 'image' && image.staged === null
        ? 'Choose the image to use.'
        : image.kind === 'text' && text.trim() === ''
          ? 'Type the words to draw.'
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
    const watermark: WatermarkSettings = {
      source:
        image.kind === 'image' && image.staged !== null
          ? { kind: 'image', token: image.staged.token }
          : { kind: 'text', text: text.trim(), style },
      opacity,
      rotation,
      scale,
      position: { horizontal: 'center', vertical: 'middle' },
      behind,
    };
    void run({ label: 'Watermark', operations: [{ kind: 'setWatermark', pages, watermark }] });
  };

  const remove = (): void => {
    void run({
      label: 'Remove watermark',
      operations: [{ kind: 'removeFurniture', pages, kinds: ['watermark'] }],
    });
  };

  return (
    <Dialog
      title="Watermark"
      description="Drawn over the page, or under it, and marked as PaperForge's own so it can be changed or taken off again."
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
                name="watermark-source"
                checked={image.kind === 'text'}
                onChange={() => image.setKind('text')}
              />
              Words
            </label>
            <label className={styles.choice}>
              <input
                type="radio"
                name="watermark-source"
                checked={image.kind === 'image'}
                onChange={() => image.setKind('image')}
              />
              An image
            </label>
          </div>

          {image.kind === 'text' ? (
            <>
              <div className={styles.row}>
                <label className={styles.label} htmlFor="watermark-text">
                  Text
                </label>
                <input
                  id="watermark-text"
                  type="text"
                  className={`${styles.input} ${styles.grow}`}
                  value={text}
                  maxLength={200}
                  onChange={(event) => setText(event.target.value)}
                />
              </div>
              <div className={styles.row}>
                <label className={styles.label} htmlFor="watermark-font">
                  Font
                </label>
                <select
                  id="watermark-font"
                  className={styles.select}
                  value={style.family}
                  onChange={(event) =>
                    setStyle({ ...style, family: event.target.value as TextFamily })
                  }
                >
                  {FAMILIES.map((family) => (
                    <option key={family.id} value={family.id}>
                      {family.label}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  className={`${styles.input} ${styles.number}`}
                  aria-label="Font size"
                  min={6}
                  max={400}
                  value={style.size}
                  onChange={(event) =>
                    setStyle({ ...style, size: Math.max(6, Number(event.target.value) || 6) })
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
            </>
          ) : (
            <div className={styles.row}>
              <Button onClick={() => void image.choose()} disabled={busy}>
                Choose image
              </Button>
              <span className={styles.hint}>
                {image.staged?.fileName ?? 'No image chosen yet.'}
              </span>
            </div>
          )}
        </fieldset>

        <fieldset className={styles.group}>
          <legend className={styles.legend}>How it looks</legend>
          <div className={styles.row}>
            <label className={styles.label} htmlFor="watermark-opacity">
              Opacity
            </label>
            <input
              id="watermark-opacity"
              type="range"
              min={5}
              max={100}
              value={Math.round(opacity * 100)}
              onChange={(event) => setOpacity(Number(event.target.value) / 100)}
            />
            <span className={styles.hint}>{`${String(Math.round(opacity * 100))}%`}</span>
          </div>
          <div className={styles.row}>
            <label className={styles.label} htmlFor="watermark-rotation">
              Rotation
            </label>
            <input
              id="watermark-rotation"
              type="number"
              className={`${styles.input} ${styles.number}`}
              min={-360}
              max={360}
              value={rotation}
              onChange={(event) => setRotation(Number(event.target.value) || 0)}
            />
            <label className={styles.label} htmlFor="watermark-scale">
              Size
            </label>
            <input
              id="watermark-scale"
              type="number"
              className={`${styles.input} ${styles.number}`}
              min={0.05}
              max={10}
              step={0.05}
              value={scale}
              onChange={(event) => setScale(Math.max(0.05, Number(event.target.value) || 1))}
            />
          </div>
          <label className={styles.choice}>
            <input
              type="checkbox"
              checked={behind}
              onChange={(event) => setBehind(event.target.checked)}
            />
            Draw it under the page's own content
          </label>
        </fieldset>

        {image.kind === 'text' && (
          <p className={own.preview} aria-label="Preview">
            <span
              className={own.previewText}
              style={{
                opacity,
                color: hexOf(style.color),
                transform: `rotate(${String(-rotation)}deg)`,
                fontFamily: cssFamily(style.family),
              }}
            >
              {text.trim() === '' ? 'DRAFT' : text}
            </span>
          </p>
        )}

        <PageScopeField
          name="watermark-scope"
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
