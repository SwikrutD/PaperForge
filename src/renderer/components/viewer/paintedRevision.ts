import { createContext, useContext } from 'react';

/**
 * The document revision a page's canvas currently shows, or null before its
 * first picture. It can lag the revision the viewer has loaded by the time it
 * takes to draw the page, which is what an overlay needs to know to keep a
 * just-made change visible until the picture has caught up with it.
 */
export const PaintedRevisionContext = createContext<number | null>(null);

export function usePaintedRevision(): number | null {
  return useContext(PaintedRevisionContext);
}

/**
 * Whether a change that produced revision `madeIn` still needs drawing over
 * the page: it does while that revision is being written (`madeIn` is null) and
 * while the page still shows an older picture. Revision numbers only grow, so
 * anything at or past `madeIn` already includes the change.
 */
export function awaitingPaint(madeIn: number | null, painted: number | null): boolean {
  return madeIn === null || painted === null || painted < madeIn;
}
