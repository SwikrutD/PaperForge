import { useEffect, useState } from 'react';

/** The pointer within this many pixels of the window's top edge offers the exit. */
const REVEAL_PX = 48;
/** ...and the exit goes again once the pointer is this far down. */
const CONCEAL_PX = 120;

/**
 * True while the pointer is at the top of the window, where the bars reading
 * mode hides used to be: that is where the reader looks for a way out. Always
 * false while `active` is.
 */
export function usePointerAtTop(active: boolean): boolean {
  const [atTop, setAtTop] = useState(false);

  useEffect(() => {
    if (!active) return;
    const onMove = (event: MouseEvent): void => {
      if (event.clientY <= REVEAL_PX) setAtTop(true);
      else if (event.clientY > CONCEAL_PX) setAtTop(false);
    };
    window.addEventListener('mousemove', onMove);
    return () => {
      window.removeEventListener('mousemove', onMove);
      // The next start begins with the exit hidden again.
      setAtTop(false);
    };
  }, [active]);

  return active && atTop;
}
