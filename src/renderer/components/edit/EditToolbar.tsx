import type { ReactElement } from 'react';
import {
  Check,
  Image as ImageIcon,
  ImagePlus,
  PenLine,
  Redo2,
  Save,
  TextCursorInput,
  Type,
  Undo2,
} from 'lucide-react';
import { Button } from '../controls/Button';
import { CommandIconButton } from '../controls/CommandIconButton';
import { IconButton } from '../controls/IconButton';
import { useImageEditStore } from '../../stores/imageEditStore';
import { useTextEditStore } from '../../stores/textEditStore';
import styles from './EditToolbar.module.css';

/**
 * The bar that says the editor is on, and how to use it.
 *
 * Text and images take the pointer in turn rather than at once: a click on a
 * caption printed over a photograph is then never a guess about which of the
 * two was meant. The bar says which is being pointed at, and what the editor
 * can and cannot do, rather than leaving the reader to find out by clicking.
 */
export function EditToolbar({
  disabled,
  hasText,
  hasImages,
}: {
  disabled: boolean;
  /** False when the page being read draws no text this editor can see. */
  hasText: boolean;
  /** False when the page being read draws no images. */
  hasImages: boolean;
}): ReactElement {
  const setActive = useTextEditStore((store) => store.setActive);
  const textBusy = useTextEditStore((store) => store.busy);
  const selected = useTextEditStore((store) => store.selected);
  const editing = useTextEditStore((store) => store.draft !== null);
  const placing = useTextEditStore((store) => store.placing);
  const setPlacing = useTextEditStore((store) => store.setPlacing);

  const images = useImageEditStore((store) => store.active);
  const imageBusy = useImageEditStore((store) => store.busy);
  const pending = useImageEditStore((store) => store.pending);
  const imageSelected = useImageEditStore((store) => store.selected);
  const busy = textBusy || imageBusy;

  /** Only one of the two layers takes the pointer at a time. */
  const showImages = (next: boolean): void => {
    useImageEditStore.getState().setActive(next);
    if (next) setPlacing(false);
    useTextEditStore.getState().select(0, null);
  };

  return (
    <div className={styles.bar} role="toolbar" aria-label="Editing">
      <span className={styles.badge}>
        <PenLine className={styles.icon} aria-hidden="true" strokeWidth={1.75} />
        Edit
      </span>

      <IconButton
        icon={Type}
        label="Edit text"
        tooltip="Point at the text on the page"
        pressed={!images}
        disabled={disabled || busy}
        onClick={() => showImages(false)}
      />
      <IconButton
        icon={ImageIcon}
        label="Edit images"
        tooltip="Point at the images on the page"
        pressed={images}
        disabled={disabled || busy}
        onClick={() => showImages(true)}
      />

      <span className={styles.divider} aria-hidden="true" />

      {images ? (
        <IconButton
          icon={ImagePlus}
          label="Add image"
          tooltip="Add an image: choose a file, then click where it goes"
          pressed={pending !== null}
          disabled={disabled || busy}
          onClick={() => {
            if (pending === null) void useImageEditStore.getState().choose();
            else useImageEditStore.getState().cancelPending();
          }}
        />
      ) : (
        <IconButton
          icon={TextCursorInput}
          label="Add text"
          tooltip="Add text: click where it should start"
          pressed={placing}
          disabled={disabled || busy}
          onClick={() => setPlacing(!placing)}
        />
      )}

      <p className={styles.hint} aria-live="polite">
        {images ? imageHint({ pending, hasImages, selected: imageSelected !== null }) : null}
        {!images
          ? placing
            ? 'Click the page where the new text should start.'
            : editing
              ? 'Enter keeps the change, Escape leaves the text as it was.'
              : !hasText
                ? 'PaperForge finds no text it can edit on this page. Add text is still available.'
                : selected === null
                  ? 'Click a piece of text to change it.'
                  : 'Type to change it, or press Escape to leave it alone.'
          : null}
      </p>

      <div className={styles.end}>
        <CommandIconButton id="edit.undo" icon={Undo2} disabled={busy} />
        <CommandIconButton id="edit.redo" icon={Redo2} disabled={busy} />
        <CommandIconButton id="file.save" icon={Save} disabled={busy} />
        <span className={styles.divider} aria-hidden="true" />
        <Button
          appearance="primary"
          icon={Check}
          disabled={disabled}
          onClick={() => {
            useImageEditStore.getState().setActive(false);
            setActive(false);
          }}
        >
          Done
        </Button>
      </div>
    </div>
  );
}

function imageHint({
  pending,
  hasImages,
  selected,
}: {
  pending: { fileName: string } | null;
  hasImages: boolean;
  selected: boolean;
}): string {
  if (pending !== null) return `Click the page where “${pending.fileName}” should go.`;
  if (!hasImages) return 'This page draws no images. Add image puts one on it.';
  if (!selected) return 'Click an image to move, resize or replace it.';
  return 'Drag to move it, drag a handle to resize it; hold Shift to keep its shape.';
}
