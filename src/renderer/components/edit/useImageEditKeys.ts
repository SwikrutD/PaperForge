import { useEffect } from 'react';
import type { PdfPageGeometry } from '@pdf/render/types';
import { isTypingTarget } from '../../keyboard/shortcuts';
import { useEditTargetStore } from '../../stores/editTargetStore';
import { useImageEditStore } from '../../stores/imageEditStore';
import { anchorAt } from '../viewer/marqueeZoom';
import { cssPointToPdf } from '../viewer/pageGeometry';
import type { PageLayout } from '../viewer/viewerLayout';
import { nudgeFor } from './imageGeometry';

/**
 * The keys the image editor answers to.
 *
 * Ctrl+V pastes a picture anywhere in Edit PDF; with an image selected,
 * Delete removes it, the arrows nudge it (Shift for further) and Escape lets
 * go of it; while cropping, Enter keeps the crop and Escape abandons it.
 *
 * None of these are commands, because a command's Ctrl chord runs even in a
 * text field, and Ctrl+V there has to paste into the field. They are taken
 * before anything else on the page sees them — the arrows would otherwise
 * scroll or turn the page — but only when nobody is typing.
 */

export interface PastePoint {
  page: number;
  x: number;
  y: number;
}

interface ImageEditKeysOptions {
  /** True while Edit PDF is open. */
  editing: boolean;
  /** Where a pasted picture should be centred: the middle of the window. */
  pastePoint: () => PastePoint | null;
  /** How far a page is turned on screen, its own turn and the view's. */
  pageRotation: (page: number) => number;
}

const ARROWS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export function useImageEditKeys({
  editing,
  pastePoint,
  pageRotation,
}: ImageEditKeysOptions): void {
  useEffect(() => {
    if (!editing) return;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || isTypingTarget(event.target)) return;
      const store = useImageEditStore.getState();
      const handled = (): void => {
        event.preventDefault();
        event.stopPropagation();
      };

      if (event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'v') {
        const point = pastePoint();
        if (point === null) return;
        handled();
        const targets = useEditTargetStore.getState();
        if (targets.target !== 'images') targets.setTarget('images');
        void store.paste(point.page, { x: point.x, y: point.y });
        return;
      }

      if (useEditTargetStore.getState().target !== 'images') return;
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      const { selected, cropping } = store;

      if (cropping !== null) {
        if (event.key === 'Enter') {
          handled();
          void store.applyCrop();
        } else if (event.key === 'Escape') {
          handled();
          store.cancelCrop();
        }
        return;
      }
      if (selected === null) return;

      if (event.key === 'Delete' || event.key === 'Backspace') {
        handled();
        void store.remove(selected.page, selected.id);
      } else if (event.key === 'Escape') {
        handled();
        store.select(selected.page, null);
      } else if (ARROWS.has(event.key)) {
        const step = nudgeFor(event.key, event.shiftKey, pageRotation(selected.page));
        if (step === null) return;
        handled();
        store.nudge(step.dx, step.dy);
      }
    };

    // The nudges of one press, however long it repeats, are one change.
    const onKeyUp = (event: KeyboardEvent): void => {
      if (!ARROWS.has(event.key)) return;
      void useImageEditStore.getState().commitNudge();
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
    };
  }, [editing, pastePoint, pageRotation]);
}

/**
 * The point of a page in the middle of the window, in PDF user space. A
 * window whose middle falls between pages lands on the edge of the nearer.
 */
export function pastePointFor(options: {
  layout: PageLayout;
  scroll: { left: number; top: number };
  viewport: { width: number; height: number };
  /** The pages laid out near the window. */
  candidates: readonly number[];
  geometryOf: (page: number) => PdfPageGeometry | undefined;
  scale: number;
  rotation: number;
}): PastePoint | null {
  const { layout, scroll, viewport } = options;
  const centre = { x: scroll.left + viewport.width / 2, y: scroll.top + viewport.height / 2 };
  const anchor = anchorAt(layout, centre, viewport.width, options.candidates);
  if (anchor === null) return null;
  const box = layout.boxes[anchor.pageNumber - 1];
  const geometry = options.geometryOf(anchor.pageNumber);
  if (box === undefined || geometry === undefined) return null;

  const clamp = (value: number): number => Math.max(0, Math.min(1, value));
  const point = cssPointToPdf(
    { x: clamp(anchor.x) * box.width, y: clamp(anchor.y) * box.height },
    geometry,
    options.scale,
    options.rotation,
  );
  return { page: anchor.pageNumber, x: point.x, y: point.y };
}
