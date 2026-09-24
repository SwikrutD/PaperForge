import { useState, type ReactElement } from 'react';
import {
  Crop,
  FlipHorizontal,
  FlipVertical,
  RotateCcw,
  RotateCw,
  Save,
  Trash2,
  Upload,
} from 'lucide-react';
import type { ImagePlacementInput } from '@shared/schemas/edit';
import { Button } from '../controls/Button';
import { IconButton } from '../controls/IconButton';
import { useDocumentStore } from '../../stores/documentStore';
import { imagesFor, useImageEditStore } from '../../stores/imageEditStore';
import { turnedBy } from './imageGeometry';
import styles from './EditProperties.module.css';

/**
 * What the selected image is, and what can be done to it.
 *
 * The box, the turn and the crop are the things the page says; the buttons
 * write them back through the same undoable change a drag does. Cropping is a
 * clip, so the image keeps every pixel it arrived with and the crop can be
 * taken off again.
 */
export function ImageProperties(): ReactElement {
  const selected = useImageEditStore((store) => store.selected);
  const pages = useImageEditStore((store) => store.pages);
  const busy = useImageEditStore((store) => store.busy);
  const pending = useImageEditStore((store) => store.pending);
  const sessionId = useDocumentStore((store) => store.activeId);
  const [trim, setTrim] = useState({ left: 0, right: 0, top: 0, bottom: 0 });

  const store = useImageEditStore.getState;
  const image =
    selected === null || sessionId === null
      ? undefined
      : imagesFor(pages, sessionId, selected.page).find((entry) => entry.id === selected.id);

  if (selected === null || image === undefined) {
    return (
      <div className={styles.panel}>
        <p className={styles.empty}>
          {pending === null
            ? 'Click an image on the page to move, resize, crop or replace it.'
            : `Click the page where “${pending.fileName}” should go.`}
        </p>
      </div>
    );
  }

  const place = (placement: ImagePlacementInput): void => {
    void store().place(selected.page, selected.id, placement);
  };

  const cropped = image.crop !== null;
  const applyCrop = (): void => {
    const x = clampUnit(trim.left / 100);
    const y = clampUnit(trim.bottom / 100);
    const width = Math.max(0.01, 1 - x - clampUnit(trim.right / 100));
    const height = Math.max(0.01, 1 - y - clampUnit(trim.top / 100));
    void store().crop(selected.page, selected.id, { x, y, width, height });
  };

  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <h3 className={styles.title}>Image</h3>
      </header>

      <dl className={styles.list}>
        <div className={styles.row}>
          <dt className={styles.label}>Pixels</dt>
          <dd className={styles.value}>
            {`${String(image.pixelWidth)} × ${String(image.pixelHeight)}`}
          </dd>
        </div>
        <div className={styles.row}>
          <dt className={styles.label}>Size on page</dt>
          <dd className={styles.value}>
            {`${round(image.placement.width)} × ${round(image.placement.height)} pt`}
          </dd>
        </div>
        <div className={styles.row}>
          <dt className={styles.label}>Position</dt>
          <dd className={styles.value}>
            {`${round(image.placement.x)}, ${round(image.placement.y)}`}
          </dd>
        </div>
        <div className={styles.row}>
          <dt className={styles.label}>Turned</dt>
          <dd className={styles.value}>{`${round(image.placement.rotation)}°`}</dd>
        </div>
        <div className={styles.row}>
          <dt className={styles.label}>Transparency</dt>
          <dd className={styles.value}>{image.hasAlpha ? 'Its own' : 'None'}</dd>
        </div>
        {image.added && (
          <div className={styles.row}>
            <dt className={styles.label}>Added</dt>
            <dd className={styles.value}>By PaperForge</dd>
          </div>
        )}
      </dl>

      <section className={styles.group}>
        <div className={styles.row}>
          <span className={styles.label}>Turn and mirror</span>
          <span className={styles.toggles}>
            <IconButton
              icon={RotateCcw}
              label="Turn left"
              tooltip="Turn left a quarter"
              disabled={busy}
              onClick={() => place(turnedBy(image.placement, 90))}
            />
            <IconButton
              icon={RotateCw}
              label="Turn right"
              tooltip="Turn right a quarter"
              disabled={busy}
              onClick={() => place(turnedBy(image.placement, -90))}
            />
            <IconButton
              icon={FlipHorizontal}
              label="Mirror across"
              tooltip="Mirror left to right"
              pressed={image.placement.flipX}
              disabled={busy}
              onClick={() => place({ ...image.placement, flipX: !image.placement.flipX })}
            />
            <IconButton
              icon={FlipVertical}
              label="Mirror down"
              tooltip="Mirror top to bottom"
              disabled={busy}
              onClick={() =>
                place(turnedBy({ ...image.placement, flipX: !image.placement.flipX }, 180))
              }
            />
          </span>
        </div>
      </section>

      <section className={styles.group}>
        <div className={styles.row}>
          <label className={styles.label} htmlFor="image-opacity">
            Opacity
          </label>
          <input
            id="image-opacity"
            type="range"
            min={5}
            max={100}
            value={Math.round(image.opacity * 100)}
            disabled={busy}
            onChange={(event) =>
              void store().setOpacity(selected.page, selected.id, Number(event.target.value) / 100)
            }
          />
          <span className={styles.value}>{`${String(Math.round(image.opacity * 100))}%`}</span>
        </div>
      </section>

      <section className={styles.group}>
        <h3 className={styles.title}>Crop</h3>
        <p className={styles.note}>
          Trims the picture without changing it, as a percentage from each edge.
        </p>
        <div className={styles.cropGrid}>
          {(['left', 'right', 'top', 'bottom'] as const).map((edge) => (
            <label key={edge} className={styles.cropField}>
              {`From the ${edge}`}
              <input
                className={styles.number}
                type="number"
                min={0}
                max={95}
                step={1}
                value={trim[edge]}
                aria-label={`Trim from the ${edge}`}
                onChange={(event) => setTrim({ ...trim, [edge]: Number(event.target.value) || 0 })}
              />
            </label>
          ))}
        </div>
        <div className={styles.actions}>
          <Button icon={Crop} disabled={busy} onClick={applyCrop}>
            Crop
          </Button>
          <Button
            disabled={busy || !cropped}
            onClick={() => {
              setTrim({ left: 0, right: 0, top: 0, bottom: 0 });
              void store().crop(selected.page, selected.id, null);
            }}
          >
            Reset crop
          </Button>
        </div>
      </section>

      <section className={styles.group}>
        <div className={styles.actions}>
          <Button
            icon={Upload}
            disabled={busy}
            onClick={() => void store().replace(selected.page, selected.id)}
          >
            Replace
          </Button>
          <Button
            icon={Save}
            disabled={busy}
            onClick={() => void store().exportImage(selected.page, selected.id)}
          >
            Save image
          </Button>
          <Button
            icon={Trash2}
            disabled={busy}
            onClick={() => void store().remove(selected.page, selected.id)}
          >
            Delete
          </Button>
        </div>
      </section>
    </div>
  );
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(0.95, value));
}

function round(value: number): string {
  return (Math.round(value * 100) / 100).toString();
}
