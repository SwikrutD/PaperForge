import type { ReactElement } from 'react';
import {
  Check,
  Crop,
  FlipHorizontal,
  FlipVertical,
  RotateCcw,
  RotateCw,
  Save,
  Scissors,
  Trash2,
  Upload,
  X,
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
 * write them back through the same undoable change a drag does. Cropping is
 * done on the page, by dragging the crop's handles. A crop is a clip, so the
 * image keeps every pixel it arrived with and the crop can be taken off again
 * — unless the reader chooses to cut the picture down, which throws the
 * hidden part away.
 */
export function ImageProperties(): ReactElement {
  const selected = useImageEditStore((store) => store.selected);
  const pages = useImageEditStore((store) => store.pages);
  const busy = useImageEditStore((store) => store.busy);
  const pending = useImageEditStore((store) => store.pending);
  const cropping = useImageEditStore((store) => store.cropping);
  const sessionId = useDocumentStore((store) => store.activeId);

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
            ? 'Click an image on the page to move, resize, turn, crop or replace it, or press Ctrl+V to paste one.'
            : `Click the page where “${pending.fileName}” should go.`}
        </p>
      </div>
    );
  }

  const place = (placement: ImagePlacementInput): void => {
    void store().place(selected.page, selected.id, placement);
  };

  const cropped = image.crop !== null;
  const croppingThis = cropping?.page === selected.page && cropping.id === selected.id;

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
        {croppingThis ? (
          <>
            <p className={styles.note}>
              Drag the crop’s edges on the page, or drag inside it to move it. Enter keeps it,
              Escape leaves the picture as it was.
            </p>
            <div className={styles.actions}>
              <Button icon={Check} disabled={busy} onClick={() => void store().applyCrop()}>
                Apply crop
              </Button>
              <Button icon={X} disabled={busy} onClick={() => store().cancelCrop()}>
                Cancel
              </Button>
            </div>
            <p className={styles.note}>
              Cutting throws away the hidden part for good: the file gets smaller and the crop
              cannot be taken off again, except by undo.
            </p>
            <div className={styles.actions}>
              <Button
                icon={Scissors}
                disabled={busy}
                onClick={() => void store().applyCrop({ cut: true })}
              >
                Cut to crop
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className={styles.note}>
              Hides part of the picture without changing it, so the crop can be taken off again.
            </p>
            <div className={styles.actions}>
              <Button icon={Crop} disabled={busy} onClick={() => store().beginCrop()}>
                Crop on page
              </Button>
              <Button
                disabled={busy || !cropped}
                onClick={() => void store().crop(selected.page, selected.id, null)}
              >
                Reset crop
              </Button>
            </div>
          </>
        )}
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

function round(value: number): string {
  return (Math.round(value * 100) / 100).toString();
}
