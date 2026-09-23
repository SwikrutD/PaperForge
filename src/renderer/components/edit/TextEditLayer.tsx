import { useEffect, useRef, type KeyboardEvent, type ReactElement } from 'react';
import type { PdfPageGeometry } from '@pdf/render/types';
import type { TextRunModel } from '@shared/schemas/text';
import { cx } from '../../utils/classNames';
import { pdfRectToCss } from '../viewer/pageGeometry';
import styles from './TextEditLayer.module.css';

interface TextEditLayerProps {
  geometry: PdfPageGeometry;
  scale: number;
  rotation: number;
  runs: readonly TextRunModel[];
  selectedId: string | null;
  /** The text being typed, when this page has the run that is open. */
  draft: string | null;
  onSelect: (id: string | null) => void;
  onBeginEdit: (id: string) => void;
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
 * A run PaperForge cannot rewrite says so rather than accepting typing that
 * could not be saved.
 */
export function TextEditLayer({
  geometry,
  scale,
  rotation,
  runs,
  selectedId,
  draft,
  onSelect,
  onBeginEdit,
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
  }, [open, selectedId]);

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

  return (
    <div
      className={styles.layer}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onSelect(null);
      }}
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
        const editing = selected && draft !== null;

        return (
          <div
            key={run.id}
            className={cx(
              styles.run,
              selected && styles.selected,
              !run.editable && styles.locked,
              run.invisible && styles.invisible,
            )}
            style={{
              left: `${String(box.left)}px`,
              top: `${String(box.top)}px`,
              width: `${String(box.width)}px`,
              height: `${String(box.height)}px`,
            }}
            data-run={run.id}
            title={run.reason ?? run.text}
            onPointerDown={(event) => {
              event.stopPropagation();
              // Opening the field on the press would lose it again: the page
              // column takes focus on pointer down, and the field would blur
              // the moment it appeared.
              if (selected && run.editable) event.preventDefault();
              else onSelect(run.id);
            }}
            onClick={() => {
              if (selected && run.editable) onBeginEdit(run.id);
            }}
            onDoubleClick={() => {
              if (run.editable) onBeginEdit(run.id);
            }}
          >
            {editing && (
              <input
                ref={inputRef}
                className={styles.input}
                value={draft}
                style={{ fontSize: `${String(Math.max(8, run.fontSize * scale))}px` }}
                aria-label={`Text: ${run.text}`}
                onChange={(event) => onDraft(event.target.value)}
                onKeyDown={onKeyDown}
                onBlur={onCommit}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
