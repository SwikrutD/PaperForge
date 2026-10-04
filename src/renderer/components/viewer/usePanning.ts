import { useEffect, type RefObject } from 'react';

/** What a press must start on to keep its own meaning under the hand tool. */
const KEEPS_POINTER = 'button, a[href], input, textarea, select, [contenteditable="true"]';

/** Scroll position after dragging the pages from one point to another. */
export function panScroll(
  start: { left: number; top: number },
  from: { x: number; y: number },
  to: { x: number; y: number },
): { left: number; top: number } {
  // The content follows the pointer, so the scroll moves the other way.
  return { left: start.left - (to.x - from.x), top: start.top - (to.y - from.y) };
}

/**
 * The hand tool: dragging anywhere on the pages scrolls them, the way a
 * reader pushes paper across a desk. Links and form fields still take a
 * click. Touch is left to the browser, which already pans with a finger.
 *
 * The press is caught on its way down to the page, so text is not selected
 * and no layer under the pointer starts a drag of its own.
 */
export function usePanning(scrollerRef: RefObject<HTMLElement | null>, enabled: boolean): void {
  useEffect(() => {
    const element = scrollerRef.current;
    if (!enabled || element === null) return;
    let drag: {
      pointerId: number;
      from: { x: number; y: number };
      start: { left: number; top: number };
    } | null = null;

    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0 || event.pointerType === 'touch') return;
      if (event.target instanceof Element && event.target.closest(KEEPS_POINTER) !== null) return;
      event.preventDefault();
      event.stopPropagation();
      // Keep the keyboard on the pages, as a click there would.
      element.focus({ preventScroll: true });
      element.setPointerCapture(event.pointerId);
      element.dataset.panning = 'true';
      drag = {
        pointerId: event.pointerId,
        from: { x: event.clientX, y: event.clientY },
        start: { left: element.scrollLeft, top: element.scrollTop },
      };
    };

    const onPointerMove = (event: PointerEvent): void => {
      if (drag === null || event.pointerId !== drag.pointerId) return;
      const next = panScroll(drag.start, drag.from, { x: event.clientX, y: event.clientY });
      element.scrollLeft = next.left;
      element.scrollTop = next.top;
    };

    const onPointerUp = (event: PointerEvent): void => {
      if (drag === null || event.pointerId !== drag.pointerId) return;
      drag = null;
      delete element.dataset.panning;
      if (element.hasPointerCapture(event.pointerId))
        element.releasePointerCapture(event.pointerId);
    };

    element.addEventListener('pointerdown', onPointerDown, { capture: true });
    element.addEventListener('pointermove', onPointerMove);
    element.addEventListener('pointerup', onPointerUp);
    element.addEventListener('pointercancel', onPointerUp);
    return () => {
      element.removeEventListener('pointerdown', onPointerDown, { capture: true });
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', onPointerUp);
      element.removeEventListener('pointercancel', onPointerUp);
      delete element.dataset.panning;
    };
  }, [scrollerRef, enabled]);
}
