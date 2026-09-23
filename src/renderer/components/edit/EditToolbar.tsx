import type { ReactElement } from 'react';
import {
  Check,
  Image as ImageIcon,
  ImagePlus,
  Link as LinkIcon,
  PenLine,
  Redo2,
  Save,
  SquarePlus,
  TextCursorInput,
  Type,
  Undo2,
} from 'lucide-react';
import { Button } from '../controls/Button';
import { CommandIconButton } from '../controls/CommandIconButton';
import { IconButton } from '../controls/IconButton';
import { useEditTargetStore, type EditTarget } from '../../stores/editTargetStore';
import { useImageEditStore } from '../../stores/imageEditStore';
import { useLinkEditStore } from '../../stores/linkEditStore';
import { useTextEditStore } from '../../stores/textEditStore';
import styles from './EditToolbar.module.css';

/**
 * The bar that says the editor is on, and how to use it.
 *
 * Text, images and links take the pointer in turn rather than at once: a click
 * on a caption printed over a photograph is then never a guess about which was
 * meant. The bar says which of them is being pointed at, and what can be done
 * with it, rather than leaving the reader to find out by clicking.
 */
export function EditToolbar({
  disabled,
  hasText,
  hasImages,
  hasLinks,
}: {
  disabled: boolean;
  /** False when the page being read draws no text this editor can see. */
  hasText: boolean;
  /** False when the page being read draws no images. */
  hasImages: boolean;
  /** False when the page carries no links. */
  hasLinks: boolean;
}): ReactElement {
  const setActive = useTextEditStore((store) => store.setActive);
  const textBusy = useTextEditStore((store) => store.busy);
  const selected = useTextEditStore((store) => store.selected);
  const editing = useTextEditStore((store) => store.draft !== null);
  const placing = useTextEditStore((store) => store.placing);
  const setPlacing = useTextEditStore((store) => store.setPlacing);

  const target = useEditTargetStore((store) => store.target);
  const setTarget = useEditTargetStore((store) => store.setTarget);
  const imageBusy = useImageEditStore((store) => store.busy);
  const pending = useImageEditStore((store) => store.pending);
  const imageSelected = useImageEditStore((store) => store.selected);
  const linkBusy = useLinkEditStore((store) => store.busy);
  const drawing = useLinkEditStore((store) => store.drawing);
  const linkSelected = useLinkEditStore((store) => store.selected);
  const busy = textBusy || imageBusy || linkBusy;

  const targets: Array<{ id: EditTarget; label: string; icon: typeof Type; tooltip: string }> = [
    { id: 'text', label: 'Edit text', icon: Type, tooltip: 'Point at the text on the page' },
    {
      id: 'images',
      label: 'Edit images',
      icon: ImageIcon,
      tooltip: 'Point at the images on the page',
    },
    { id: 'links', label: 'Edit links', icon: LinkIcon, tooltip: 'Point at the links on the page' },
  ];

  return (
    <div className={styles.bar} role="toolbar" aria-label="Editing">
      <span className={styles.badge}>
        <PenLine className={styles.icon} aria-hidden="true" strokeWidth={1.75} />
        Edit
      </span>

      {targets.map((entry) => (
        <IconButton
          key={entry.id}
          icon={entry.icon}
          label={entry.label}
          tooltip={entry.tooltip}
          pressed={target === entry.id}
          disabled={disabled || busy}
          onClick={() => setTarget(entry.id)}
        />
      ))}

      <span className={styles.divider} aria-hidden="true" />

      {target === 'images' ? (
        <IconButton
          icon={ImagePlus}
          label="Add image"
          tooltip="Add an image: choose a file, then click where it goes"
          pressed={pending !== null}
          disabled={disabled || busy}
          onClick={() => {
            if (pending === null) void useImageEditStore.getState().choose();
            else useImageEditStore.getState().reset();
          }}
        />
      ) : target === 'links' ? (
        <IconButton
          icon={SquarePlus}
          label="Add link"
          tooltip="Add a link: drag the area it should cover"
          pressed={drawing}
          disabled={disabled || busy}
          onClick={() => useLinkEditStore.getState().setDrawing(!drawing)}
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
        {target === 'images'
          ? imageHint({ pending, hasImages, selected: imageSelected !== null })
          : target === 'links'
            ? linkHint({ drawing, hasLinks, selected: linkSelected !== null })
            : textHint({ placing, editing, hasText, selected: selected !== null })}
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
          onClick={() => setActive(false)}
        >
          Done
        </Button>
      </div>
    </div>
  );
}

function textHint({
  placing,
  editing,
  hasText,
  selected,
}: {
  placing: boolean;
  editing: boolean;
  hasText: boolean;
  selected: boolean;
}): string {
  if (placing) return 'Click the page where the new text should start.';
  if (editing) return 'Enter keeps the change, Escape leaves the text as it was.';
  if (!hasText) {
    return 'PaperForge finds no text it can edit on this page. Add text is still available.';
  }
  return selected
    ? 'Type to change it, or press Escape to leave it alone.'
    : 'Click a piece of text to change it.';
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

function linkHint({
  drawing,
  hasLinks,
  selected,
}: {
  drawing: boolean;
  hasLinks: boolean;
  selected: boolean;
}): string {
  if (drawing) return 'Drag the area the new link should cover.';
  if (!hasLinks) return 'This page carries no links. Add link draws one.';
  if (!selected) return 'Click a link to move it or to change where it goes.';
  return 'Drag to move it, drag a handle to resize it; the panel says where it goes.';
}
