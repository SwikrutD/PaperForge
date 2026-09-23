import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactElement } from 'react';
import type { LoadedPdfDocument } from '@pdf/render/types';
import { cx } from '../../utils/classNames';
import { PageThumbnail } from '../pages/PageThumbnail';
import { allPages, isNoopMove, moveSelection, type SelectionState } from './organizeSelection';
import styles from './PageGrid.module.css';

/** How wide a page is drawn in the grid, in CSS pixels. */
const THUMBNAIL_WIDTH = 150;
/** A drag has to travel this far before it counts as one. */
const DRAG_THRESHOLD = 6;

interface PageGridProps {
  document: LoadedPdfDocument;
  /** Bumped when the document changes, so thumbnails are drawn again. */
  version: number;
  selection: SelectionState;
  onSelect: (selection: SelectionState) => void;
  onChoose: (pageNumber: number, modifier: 'replace' | 'toggle' | 'range') => void;
  /** Called with the pages to move and where they should land. */
  onMove: (pages: number[], toIndex: number) => void;
  /** Opened by a double click: go to the page in the viewer. */
  onOpenPage: (pageNumber: number) => void;
}

interface DragState {
  /** Where the pointer went down, to tell a click from a drag. */
  origin: { x: number; y: number };
  pages: number[];
  /** Insertion point under the pointer, counted in pages. */
  target: number | null;
  active: boolean;
}

/**
 * The page grid: every page of the document, in order, as something to pick up
 * and put down.
 *
 * Nothing here changes the document. A drop asks for a move, which goes
 * through the same undoable pipeline as any other change, and the grid redraws
 * from what came back.
 */
export function PageGrid({
  document: pdf,
  version,
  selection,
  onSelect,
  onChoose,
  onMove,
  onOpenPage,
}: PageGridProps): ReactElement {
  const listRef = useRef<HTMLOListElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const pages = pdf.pages;
  const chosen = new Set(selection.pages);

  /** The insertion point nearest the pointer, counted in pages. */
  const dropTargetAt = (clientX: number, clientY: number): number => {
    const items = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-page]') ?? [])];
    let best = items.length;
    let bestDistance = Number.POSITIVE_INFINITY;

    items.forEach((item, index) => {
      const box = item.getBoundingClientRect();
      for (const [edge, at] of [
        [box.left, index],
        [box.right, index + 1],
      ] as const) {
        const distance = Math.hypot(edge - clientX, box.top + box.height / 2 - clientY);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = at;
        }
      }
    });
    return best;
  };

  const onPointerDown = (event: PointerEvent<HTMLElement>, pageNumber: number): void => {
    if (event.button !== 0) return;
    // Capture keeps the drag alive when the pointer leaves the page it started
    // on, which is most of the time.
    event.currentTarget.setPointerCapture(event.pointerId);
    const modifier = event.shiftKey ? 'range' : event.ctrlKey || event.metaKey ? 'toggle' : null;

    // A plain press on an unchosen page chooses it, so a drag moves what is
    // under the pointer rather than whatever was chosen before.
    if (modifier === null && !chosen.has(pageNumber)) onChoose(pageNumber, 'replace');
    else if (modifier !== null) onChoose(pageNumber, modifier);

    const moving = modifier === null && chosen.has(pageNumber) ? selection.pages : [pageNumber];
    setDrag({
      origin: { x: event.clientX, y: event.clientY },
      pages: moving.length > 0 ? moving : [pageNumber],
      target: null,
      active: false,
    });
  };

  const onPointerMove = (event: PointerEvent<HTMLElement>): void => {
    if (drag === null) return;
    const travelled = Math.hypot(event.clientX - drag.origin.x, event.clientY - drag.origin.y);
    if (!drag.active && travelled < DRAG_THRESHOLD) return;

    setDrag({ ...drag, active: true, target: dropTargetAt(event.clientX, event.clientY) });
  };

  const onPointerUp = (): void => {
    if (drag === null) return;
    const { active, target, pages: moving } = drag;
    setDrag(null);

    if (!active || target === null) return;
    const order = allPages(pages.length);
    if (isNoopMove(order, moving, target)) return;
    onMove(moving, target);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLOListElement>): void => {
    const columns = columnsOf(listRef.current);
    const step =
      event.key === 'ArrowRight'
        ? 1
        : event.key === 'ArrowLeft'
          ? -1
          : event.key === 'ArrowDown'
            ? columns
            : event.key === 'ArrowUp'
              ? -columns
              : 0;
    if (step === 0) return;

    event.preventDefault();
    onSelect(moveSelection(selection, step, pages.length, event.shiftKey));
  };

  return (
    <ol
      className={styles.grid}
      ref={listRef}
      aria-label="Pages"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDrag(null)}
    >
      {pages.map((page, index) => {
        const pageNumber = page.pageNumber;
        const isChosen = chosen.has(pageNumber);
        const dropBefore = drag?.active === true && drag.target === index;
        const dropAfter = drag?.active === true && drag.target === index + 1;

        return (
          <li
            key={pageNumber}
            className={cx(
              styles.item,
              dropBefore && styles.dropBefore,
              dropAfter && styles.dropAfter,
            )}
            data-page={pageNumber}
          >
            <button
              type="button"
              className={cx(
                styles.page,
                isChosen && styles.chosen,
                drag?.active === true && drag.pages.includes(pageNumber) && styles.lifted,
              )}
              aria-pressed={isChosen}
              aria-label={`Page ${page.label ?? String(pageNumber)}`}
              onPointerDown={(event) => onPointerDown(event, pageNumber)}
              onDoubleClick={() => onOpenPage(pageNumber)}
            >
              <PageThumbnail document={pdf} page={page} width={THUMBNAIL_WIDTH} version={version} />
              <span className={styles.caption}>
                <span className={styles.number}>{pageNumber}</span>
                {page.label !== null && page.label !== String(pageNumber) && (
                  <span className={styles.label}>{page.label}</span>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/** How many pages fit across, so the arrow keys move a row at a time. */
function columnsOf(list: HTMLOListElement | null): number {
  if (list === null) return 1;
  const items = [...list.querySelectorAll<HTMLElement>('[data-page]')];
  const first = items[0];
  if (first === undefined) return 1;

  const top = first.getBoundingClientRect().top;
  const inRow = items.filter((item) => Math.abs(item.getBoundingClientRect().top - top) < 4);
  return Math.max(1, inRow.length);
}
