import { useEffect, useRef, type RefObject } from 'react';
import { marqueeRect, type ContentRect } from './marqueeZoom';

const KEEPS_POINTER = 'input, textarea, select, [contenteditable="true"]';

interface MarqueeHandlers {
  /** The rectangle being dragged, or null once it is finished or abandoned. */
  onDraw: (rect: ContentRect | null) => void;
  /** A finished drag, or a click; `zoomOut` is true with Shift held. */
  onFinish: (rect: ContentRect, zoomOut: boolean) => void;
}

/**
 * Marquee zoom: drag a rectangle over the pages and the view zooms to fit
 * it; click to zoom in a step there, Shift+click to zoom out. Escape abandons
 * a drag. Positions are in the scroller's content, so the rectangle stays put
 * if the pages scroll underneath it.
 */
export function useMarqueeZoom(
  scrollerRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  handlers: MarqueeHandlers,
): void {
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  useEffect(() => {
    const element = scrollerRef.current;
    if (!enabled || element === null) return;
    let drag: { pointerId: number; from: { x: number; y: number } } | null = null;

    const contentPoint = (event: PointerEvent): { x: number; y: number } => {
      const bounds = element.getBoundingClientRect();
      return {
        x: event.clientX - bounds.left + element.scrollLeft,
        y: event.clientY - bounds.top + element.scrollTop,
      };
    };

    const end = (pointerId: number): void => {
      drag = null;
      handlersRef.current.onDraw(null);
      if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
    };

    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0) return;
      if (event.target instanceof Element && event.target.closest(KEEPS_POINTER) !== null) return;
      event.preventDefault();
      event.stopPropagation();
      element.focus({ preventScroll: true });
      element.setPointerCapture(event.pointerId);
      drag = { pointerId: event.pointerId, from: contentPoint(event) };
    };

    const onPointerMove = (event: PointerEvent): void => {
      if (drag === null || event.pointerId !== drag.pointerId) return;
      handlersRef.current.onDraw(marqueeRect(drag.from, contentPoint(event)));
    };

    const onPointerUp = (event: PointerEvent): void => {
      if (drag === null || event.pointerId !== drag.pointerId) return;
      const rect = marqueeRect(drag.from, contentPoint(event));
      end(event.pointerId);
      handlersRef.current.onFinish(rect, event.shiftKey);
    };

    const onPointerCancel = (event: PointerEvent): void => {
      if (drag !== null && event.pointerId === drag.pointerId) end(event.pointerId);
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || drag === null) return;
      event.preventDefault();
      event.stopPropagation();
      end(drag.pointerId);
    };

    element.addEventListener('pointerdown', onPointerDown, { capture: true });
    element.addEventListener('pointermove', onPointerMove);
    element.addEventListener('pointerup', onPointerUp);
    element.addEventListener('pointercancel', onPointerCancel);
    element.addEventListener('keydown', onKeyDown);
    return () => {
      element.removeEventListener('pointerdown', onPointerDown, { capture: true });
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', onPointerUp);
      element.removeEventListener('pointercancel', onPointerCancel);
      element.removeEventListener('keydown', onKeyDown);
      handlersRef.current.onDraw(null);
    };
  }, [scrollerRef, enabled]);
}
