import { useEffect, useRef, type KeyboardEvent, type PointerEvent, type ReactElement } from 'react';
import type { PdfPageGeometry } from '@pdf/render/types';
import type { TextRunModel } from '@shared/schemas/text';
import { cx } from '../../utils/classNames';
import { cssPointToPdf, pdfRectToCss } from '../viewer/pageGeometry';
import { awaitingPaint, usePaintedRevision } from '../viewer/paintedRevision';
import type { PendingText, TextPlacement } from '../../stores/textEditStore';
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
  /** The size new text will be written at, in points. */
  newTextSize: number;
  /** Text just written on this page, until the page is drawn with it. */
  pending?: PendingText | null;
  /** Called once the page's picture shows the pending text itself. */
  onSettle?: () => void;
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
  newTextSize,
  pending = null,
  onSettle,
  onSelect,
  onBeginEdit,
  onPlace,
  onDraft,
  onCommit,
  onCancel,
}: TextEditLayerProps): ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  const open = draft !== null;
  const painted = usePaintedRevision();
  const showPending = pending !== null && awaitingPaint(pending.madeIn, painted);

  // Once the picture has the new words, the picture is what shows them.
  useEffect(() => {
    if (pending !== null && !awaitingPaint(pending.madeIn, painted)) onSettle?.();
  }, [pending, painted, onSettle]);

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
      onBlur={(event) => {
        // Choosing a size or a colour for this text is part of editing it:
        // focus moving into the style controls does not write it yet.
        const next = event.relatedTarget;
        if (next instanceof Element && next.closest('[data-keeps-text-draft]') !== null) return;
        onCommit();
      }}
    />
  );

  // The box for new text sits on its baseline, a line of type high: a
  // quarter of the size below the baseline and the rest above it.
  const placementBox =
    placement === null
      ? null
      : pdfRectToCss(
          {
            x: placement.x,
            y: placement.y - newTextSize * 0.25,
            width: Math.max(240, newTextSize * 12),
            height: newTextSize * 1.5,
          },
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
              // A press in the open field is the field's own: it puts the
              // caret where it lands, or starts a selection.
              if (inField(event.target)) return;
              // Opening the field on the press would lose it again: the page
              // column takes focus on pointer down, and the field would blur
              // the moment it appeared.
              if (selected) event.preventDefault();
              else onSelect(run.id);
            }}
            onClick={(event) => {
              // Clicks in the open field move the caret; they do not reopen it.
              if (!placing && selected && !inField(event.target)) onBeginEdit(run.id);
            }}
            onDoubleClick={(event) => {
              // A double click in the open field selects a word, as in any field.
              if (!placing && !inField(event.target)) onBeginEdit(run.id);
            }}
          >
            {editing && field(draft, `Text: ${run.text}`, run.fontSize)}
          </div>
        );
      })}

      {showPending && (
        <PendingTextMark pending={pending} geometry={geometry} scale={scale} rotation={rotation} />
      )}

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
          {field(draft, 'New text', newTextSize)}
        </div>
      )}
    </div>
  );
}

/** True when an event started inside the open text field. */
function inField(target: EventTarget): boolean {
  return target instanceof Element && target.closest('input') !== null;
}

const FAMILIES = {
  helvetica: 'Helvetica, Arial, sans-serif',
  times: '"Times New Roman", Times, serif',
  courier: '"Courier New", Courier, monospace',
} as const;

/** The words just written, over the words they replace, until the page has them. */
function PendingTextMark({
  pending,
  geometry,
  scale,
  rotation,
}: {
  pending: PendingText;
  geometry: PdfPageGeometry;
  scale: number;
  rotation: number;
}): ReactElement {
  const cover =
    pending.covers === null ? null : pdfRectToCss(pending.covers, geometry, scale, rotation);
  const size = pending.fontSize * scale;
  // The baseline sits about four fifths of the way down a line of type.
  const origin = pdfRectToCss(
    { x: pending.x, y: pending.y, width: 0.01, height: 0.01 },
    geometry,
    scale,
    rotation,
  );
  const channel = (value: number): number => Math.round(value * 255);
  const { r, g, b } = pending.color;

  return (
    <>
      {cover !== null && (
        <span
          className={styles.pendingCover}
          style={{
            left: `${String(cover.left - 1)}px`,
            top: `${String(cover.top - 1)}px`,
            width: `${String(cover.width + 2)}px`,
            height: `${String(cover.height + 2)}px`,
          }}
          aria-hidden="true"
        />
      )}
      {origin !== null && (
        <span
          className={styles.pendingText}
          style={{
            left: `${String(origin.left)}px`,
            top: `${String(origin.top - size * 0.8)}px`,
            fontSize: `${String(size)}px`,
            fontFamily: FAMILIES[pending.family],
            color: `rgb(${String(channel(r))}, ${String(channel(g))}, ${String(channel(b))})`,
          }}
          data-pending-text
        >
          {pending.text}
        </span>
      )}
    </>
  );
}
