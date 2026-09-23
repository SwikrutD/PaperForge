import { useEffect, useRef, type KeyboardEvent, type PointerEvent, type ReactElement } from 'react';
import type { PdfPageGeometry } from '@pdf/render/types';
import type { TextRunModel } from '@shared/schemas/text';
import { cx } from '../../utils/classNames';
import { cssPointToPdf, pdfRectToCss } from '../viewer/pageGeometry';
import type { TextPlacement } from '../../stores/textEditStore';
import styles from './TextEditLayer.module.css';

interface TextEditLayerProps {
  geometry: PdfPageGeometry;
  scale: number;
  rotation: number;
  runs: readonly TextRunModel[];
  selectedId: string | null;
  /** The text being typed, when this page has the run or box that is open. */
  draft: string | null;
  /** Where new text is going, when the reader has pointed at this page. */
  placement: TextPlacement | null;
  /** True while the reader is choosing where new text goes. */
  placing: boolean;
  onSelect: (id: string | null) => void;
  onBeginEdit: (id: string) => void;
  onPlace: (x: number, y: number) => void;
  onDraft: (text: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}

/**
 * The text of a page, as something to point at.
 *
 * Every run the page draws gets a box: click one to select it, click again —
 * or press Enter — to type into it. The box sits exactly where the text is,
 * because it comes from the same geometry the page was drawn with.
 *
 * A run PaperForge cannot rewrite in its own font is marked as such: typing in
 * it is allowed, and what comes of it is a replacement the reader is asked
 * about before anything is written.
 */
export function TextEditLayer({
  geometry,
  scale,
  rotation,
  runs,
  selectedId,
  draft,
  placement,
  placing,
  onSelect,
  onBeginEdit,
  onPlace,
  onDraft,
  onCommit,
  onCancel,
}: TextEditLayerProps): ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  const open = draft !== null;

  // Typing starts as soon as a run is opened, with everything selected — once,
  // when it opens, not again on every keystroke.
  useEffect(() => {
    if (!open) return;
    const input = inputRef.current;
    if (input === null) return;
    input.focus();
    input.select();
  }, [open, selectedId, placement]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      onCommit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
    }
    // Everything else belongs to the field, not to the document.
    event.stopPropagation();
  };

  /** A click on the page: either put new text there, or select nothing. */
  const onBackground = (event: PointerEvent<HTMLDivElement>): void => {
    if (!placing) {
      // Only a click on the page itself clears the selection; a click on a run
      // has already dealt with it.
      if (event.target === event.currentTarget) onSelect(null);
      return;
    }

    // The page column takes focus on pointer down, which would blur the field
    // the moment it appeared.
    event.preventDefault();

    const box = event.currentTarget.getBoundingClientRect();
    const point = cssPointToPdf(
      { x: event.clientX - box.left, y: event.clientY - box.top },
      geometry,
      scale,
      rotation,
    );
    onPlace(point.x, point.y);
  };

  const field = (value: string, label: string, fontSize: number): ReactElement => (
    <input
      ref={inputRef}
      className={styles.input}
      value={value}
      style={{ fontSize: `${String(Math.max(8, fontSize * scale))}px` }}
      aria-label={label}
      onChange={(event) => onDraft(event.target.value)}
      onKeyDown={onKeyDown}
      onBlur={onCommit}
    />
  );

  const placementBox =
    placement === null
      ? null
      : pdfRectToCss(
          { x: placement.x, y: placement.y - 4, width: 240, height: 24 },
          geometry,
          scale,
          rotation,
        );

  return (
    <div
      className={cx(styles.layer, placing && styles.placing)}
      data-text-layer={placing ? 'placing' : 'editing'}
      onPointerDown={onBackground}
    >
      {runs.map((run) => {
        const box = pdfRectToCss(
          { x: run.x, y: run.y, width: run.width, height: run.height },
          geometry,
          scale,
          rotation,
        );
        if (box === null) return null;

        const selected = run.id === selectedId;
        const editing = selected && draft !== null && placement === null;

        return (
          <div
            key={run.id}
            className={cx(
              styles.run,
              selected && styles.selected,
              !run.editable && styles.substitute,
              run.invisible && styles.invisible,
            )}
            style={{
              left: `${String(box.left)}px`,
              top: `${String(box.top)}px`,
              width: `${String(box.width)}px`,
              height: `${String(box.height)}px`,
            }}
            data-run={run.id}
            data-editable={run.editable ? 'native' : 'replace'}
            title={run.editable ? run.text : `${run.text}\n\n${run.reason ?? ''}`.trim()}
            onPointerDown={(event) => {
              // While choosing where new text goes, a run is just part of the
              // page: the press belongs to the layer underneath.
              if (placing) return;
              event.stopPropagation();
              // Opening the field on the press would lose it again: the page
              // column takes focus on pointer down, and the field would blur
              // the moment it appeared.
              if (selected) event.preventDefault();
              else onSelect(run.id);
            }}
            onClick={() => {
              if (!placing && selected) onBeginEdit(run.id);
            }}
            onDoubleClick={() => {
              if (!placing) onBeginEdit(run.id);
            }}
          >
            {editing && field(draft, `Text: ${run.text}`, run.fontSize)}
          </div>
        );
      })}

      {placement !== null && placementBox !== null && draft !== null && (
        <div
          className={cx(styles.run, styles.selected, styles.newText)}
          style={{
            left: `${String(placementBox.left)}px`,
            top: `${String(placementBox.top)}px`,
            width: `${String(placementBox.width)}px`,
            height: `${String(placementBox.height)}px`,
          }}
          data-new-text="true"
        >
          {field(draft, 'New text', 12)}
        </div>
      )}
    </div>
  );
}
