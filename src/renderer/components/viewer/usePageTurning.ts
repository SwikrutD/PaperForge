import { useEffect, useRef, type RefObject } from 'react';
import { INITIAL_WHEEL_TURN, keyTurn, wheelTurn } from './singlePage';

export type PageTurn = 'next' | 'previous' | 'first' | 'last';

/** True for the controls a key belongs to rather than the page: form fields, editors. */
function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/**
 * Page turning for single-page view: the wheel turns the page once the reader
 * keeps scrolling past its end, and the paging keys turn it at its ends.
 * Nothing is attached while `enabled` is false, so continuous scrolling keeps
 * the browser's own behaviour.
 */
export function usePageTurning(
  scrollerRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  onTurn: (turn: PageTurn) => void,
): void {
  const onTurnRef = useRef(onTurn);
  useEffect(() => {
    onTurnRef.current = onTurn;
  }, [onTurn]);

  useEffect(() => {
    const element = scrollerRef.current;
    if (!enabled || element === null) return;
    let wheelState = INITIAL_WHEEL_TURN;

    const onWheel = (event: WheelEvent): void => {
      // Ctrl+wheel is zoom, handled by the viewer.
      if (event.ctrlKey || event.deltaY === 0) return;
      const result = wheelTurn(wheelState, event.deltaY, element, event.timeStamp);
      wheelState = result.state;
      if (result.turn === 0) return;
      event.preventDefault();
      onTurnRef.current(result.turn === 1 ? 'next' : 'previous');
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey) return;
      if (isEditable(event.target)) return;
      const turn = keyTurn(event.key, element);
      if (turn === null) return;
      event.preventDefault();
      onTurnRef.current(turn);
    };

    element.addEventListener('wheel', onWheel, { passive: false });
    element.addEventListener('keydown', onKeyDown);
    return () => {
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('keydown', onKeyDown);
    };
  }, [scrollerRef, enabled]);
}
